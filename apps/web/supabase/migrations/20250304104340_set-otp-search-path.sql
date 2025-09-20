-- Create a function to create a nonce
create or replace function public.create_nonce (
    p_user_id UUID default null,
    p_purpose TEXT default null,
    p_expires_in_seconds INTEGER default 3600, -- 1 hour by default
    p_metadata JSONB default null,
    p_scopes text[] default null,
    p_revoke_previous BOOLEAN default true -- New parameter to control automatic revocation
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
    set
        search_path to '' as $$
DECLARE
    v_client_token TEXT;
    v_nonce TEXT;
    v_expires_at TIMESTAMPTZ;
    v_id UUID;
    v_plaintext_token TEXT;
    v_revoked_count INTEGER;
BEGIN
    -- Revoke previous tokens for the same user and purpose if requested
    -- This only applies if a user ID is provided (not for anonymous tokens)
    IF p_revoke_previous = TRUE AND p_user_id IS NOT NULL THEN
        WITH revoked AS (
            UPDATE public.nonces
                SET
                    revoked = TRUE,
                    revoked_reason = 'Superseded by new token with same purpose'
                WHERE
                    user_id = p_user_id
                        AND purpose = p_purpose
                        AND used_at IS NULL
                        AND revoked = FALSE
                        AND expires_at > NOW()
                RETURNING 1
        )
        SELECT COUNT(*) INTO v_revoked_count FROM revoked;
    END IF;

    -- Generate a 6-digit token
    v_plaintext_token := (100000 + floor(random() * 900000))::text;
    v_client_token := extensions.crypt(v_plaintext_token, extensions.gen_salt('bf'));

    -- Still generate a secure nonce for internal use
    v_nonce := encode(extensions.gen_random_bytes(24), 'base64');
    v_nonce := extensions.crypt(v_nonce, extensions.gen_salt('bf'));

    -- Calculate expiration time
    v_expires_at := NOW() + (p_expires_in_seconds * interval '1 second');

    -- Insert the new nonce
    INSERT INTO public.nonces (
        client_token,
        nonce,
        user_id,
        expires_at,
        metadata,
        purpose,
        scopes
    )
    VALUES (
               v_client_token,
               v_nonce,
               p_user_id,
               v_expires_at,
               COALESCE(p_metadata, '{}'::JSONB),
               p_purpose,
               COALESCE(p_scopes, '{}'::TEXT[])
           )
    RETURNING id INTO v_id;

    -- Return the token information
    -- Note: returning the plaintext token, not the hash
    RETURN jsonb_build_object(
            'id', v_id,
            'token', v_plaintext_token,
            'expires_at', v_expires_at,
            'revoked_previous_count', COALESCE(v_revoked_count, 0)
           );
END;
$$;

grant
    execute on function public.create_nonce to service_role;

-- Create a function to verify a nonce
--
create or replace function public.verify_nonce (
    p_token TEXT,
    p_purpose TEXT,
    p_user_id UUID default null,
    p_required_scopes text[] default null,
    p_max_verification_attempts INTEGER default 5,
    p_ip INET default null,
    p_user_agent TEXT default null
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
    set
        SEARCH_PATH to '' as $$
DECLARE
    v_nonce          RECORD;
    v_matching_count INTEGER;
BEGIN
    -- Count how many matching tokens exist before verification attempt
    SELECT COUNT(*)
    INTO v_matching_count
    FROM public.nonces
    WHERE purpose = p_purpose;

    -- Update verification attempt counter and tracking info for all matching tokens
    UPDATE public.nonces
    SET verification_attempts        = verification_attempts + 1,
        last_verification_at         = NOW(),
        last_verification_ip         = COALESCE(p_ip, last_verification_ip),
        last_verification_user_agent = COALESCE(p_user_agent, last_verification_user_agent)
    WHERE client_token = extensions.crypt(p_token, client_token)
      AND purpose = p_purpose;

    -- Find the nonce by token and purpose
    -- Modified to handle user-specific tokens better
    SELECT *
    INTO v_nonce
    FROM public.nonces
    WHERE client_token = extensions.crypt(p_token, client_token)
      AND purpose = p_purpose
      -- Only apply user_id filter if the token was created for a specific user
      AND (
        -- Case 1: Anonymous token (user_id is NULL in DB)
        (user_id IS NULL)
            OR
            -- Case 2: User-specific token (check if user_id matches)
        (user_id = p_user_id)
        )
      AND used_at IS NULL
      AND NOT revoked
      AND expires_at > NOW();

    -- Check if nonce exists
    IF v_nonce.id IS NULL THEN
        RETURN jsonb_build_object(
                'valid', false,
                'message', 'Invalid or expired token'
               );
    END IF;

    -- Check if max verification attempts exceeded
    IF p_max_verification_attempts > 0 AND v_nonce.verification_attempts > p_max_verification_attempts THEN
        -- Automatically revoke the token
        UPDATE public.nonces
        SET revoked        = TRUE,
            revoked_reason = 'Maximum verification attempts exceeded'
        WHERE id = v_nonce.id;

        RETURN jsonb_build_object(
                'valid', false,
                'message', 'Token revoked due to too many verification attempts',
                'max_attempts_exceeded', true
               );
    END IF;

    -- Check scopes if required
    IF p_required_scopes IS NOT NULL AND array_length(p_required_scopes, 1) > 0 THEN
        -- Fix scope validation to properly check if token scopes contain all required scopes
        -- Using array containment check: array1 @> array2 (array1 contains array2)
        IF NOT (v_nonce.scopes @> p_required_scopes) THEN
            RETURN jsonb_build_object(
                    'valid', false,
                    'message', 'Token does not have required permissions',
                    'token_scopes', v_nonce.scopes,
                    'required_scopes', p_required_scopes
                   );
        END IF;
    END IF;

    -- Mark nonce as used
    UPDATE public.nonces
    SET used_at = NOW()
    WHERE id = v_nonce.id;

    -- Return success with metadata
    RETURN jsonb_build_object(
            'valid', true,
            'user_id', v_nonce.user_id,
            'metadata', v_nonce.metadata,
            'scopes', v_nonce.scopes,
            'purpose', v_nonce.purpose
           );
END;
$$;

grant
    execute on function public.verify_nonce to authenticated,
    service_role;

alter function public.revoke_nonce
    set
        search_path to '';

alter function kit.cleanup_expired_nonces
    set
        search_path to '';

alter function public.get_nonce_status
    set
        search_path to '';