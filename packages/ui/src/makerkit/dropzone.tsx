'use client';

import {
  type PropsWithChildren,
  createContext,
  useCallback,
  useContext,
} from 'react';

import { CheckCircle, File, Loader2, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type UseSupabaseUploadReturn } from '../hooks/use-supabase-upload';
import { cn } from '../lib/utils';
import { Button } from '../shadcn/button';
import { Trans } from './trans';

export const formatBytes = (
  bytes: number,
  decimals = 2,
  size?: 'bytes' | 'KB' | 'MB' | 'GB' | 'TB' | 'PB' | 'EB' | 'ZB' | 'YB',
) => {
  const k = 1000;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  if (bytes === 0 || bytes === undefined) {
    return size !== undefined ? `0 ${size}` : '0 bytes';
  }

  const i =
    size !== undefined
      ? sizes.indexOf(size)
      : Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

type DropzoneContextType = Omit<
  UseSupabaseUploadReturn,
  'getRootProps' | 'getInputProps'
>;

const DropzoneContext = createContext<DropzoneContextType | undefined>(
  undefined,
);

type DropzoneProps = UseSupabaseUploadReturn & {
  className?: string;
};

const Dropzone = ({
  className,
  children,
  getRootProps,
  getInputProps,
  ...restProps
}: PropsWithChildren<DropzoneProps>) => {
  const isSuccess = restProps.isSuccess;
  const isActive = restProps.isDragActive;

  const isInvalid =
    (restProps.isDragActive && restProps.isDragReject) ||
    (restProps.errors.length > 0 && !restProps.isSuccess) ||
    restProps.files.some((file) => file.errors.length !== 0);

  return (
    <DropzoneContext.Provider value={{ ...restProps }}>
      <div
        {...getRootProps({
          className: cn(
            'rounded-lg border bg-card p-6 text-center text-foreground transition-colors duration-300',
            className,
            isSuccess ? 'border-solid' : 'border-dashed',
            isActive && 'border-primary',
            isInvalid && 'border-destructive bg-destructive/10',
          ),
        })}
      >
        <input {...getInputProps()} />
        {children}
      </div>
    </DropzoneContext.Provider>
  );
};

const DropzoneContent = ({ className }: { className?: string }) => {
  const {
    files,
    setFiles,
    onUpload,
    loading,
    successes,
    errors,
    maxFileSize,
    maxFiles,
    isSuccess,
  } = useDropzoneContext();

  const { t } = useTranslation();

  const exceedMaxFiles = files.length > maxFiles;

  const handleRemoveFile = useCallback(
    (fileName: string) => {
      setFiles(files.filter((file) => file.name !== fileName));
    },
    [files, setFiles],
  );

  if (isSuccess) {
    return (
      <div
        className={cn(
          'flex flex-row items-center justify-center gap-x-2',
          className,
        )}
      >
        <CheckCircle size={16} className="text-primary" />

        <p className="text-sm text-primary">
          <Trans
            i18nKey="common:dropzone.success"
            values={{ count: files.length }}
          />
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {files.map((file, idx) => {
        const fileError = errors.find((e) => e.name === file.name);
        const isSuccessfullyUploaded = !!successes.find((e) => e === file.name);

        return (
          <div
            key={`${file.name}-${idx}`}
            className="flex items-center gap-x-4 border-b py-2 first:mt-4 last:mb-4"
          >
            {file.type.startsWith('image/') ? (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  decoding={'async'}
                  src={file.preview}
                  alt={file.name}
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded border bg-muted">
                <File size={18} />
              </div>
            )}

            <div className="flex shrink grow flex-col items-start truncate">
              <p title={file.name} className="max-w-full truncate text-sm">
                {file.name}
              </p>

              {file.errors.length > 0 ? (
                <p className="text-xs text-destructive">
                  {file.errors
                    .map((e) =>
                      e.message.startsWith('File is larger than')
                        ? t('common:dropzone.errorMessageFileSizeTooLarge', {
                            size: formatBytes(file.size, 2),
                            maxSize: formatBytes(maxFileSize, 2),
                          })
                        : e.message,
                    )
                    .join(', ')}
                </p>
              ) : loading && !isSuccessfullyUploaded ? (
                <p className="text-xs text-muted-foreground">
                  <Trans i18nKey="common:dropzone.uploading" />
                </p>
              ) : fileError ? (
                <p className="text-xs text-destructive">
                  <Trans
                    i18nKey="common:dropzone.errorMessage"
                    values={{ message: fileError.message }}
                  />
                </p>
              ) : isSuccessfullyUploaded ? (
                <p className="text-xs text-primary">
                  <Trans i18nKey="common:dropzone.success" />
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.size, 2)}
                </p>
              )}
            </div>

            {!loading && !isSuccessfullyUploaded && (
              <Button
                size="icon"
                variant="link"
                className="shrink-0 justify-self-end text-muted-foreground hover:text-foreground"
                onClick={() => handleRemoveFile(file.name)}
              >
                <X />
              </Button>
            )}
          </div>
        );
      })}
      {exceedMaxFiles && (
        <p className="mt-2 text-left text-sm text-destructive">
          <Trans
            i18nKey="common:dropzone.errorMaxFiles"
            values={{ count: maxFiles, files: files.length - maxFiles }}
          />
        </p>
      )}
      {files.length > 0 && !exceedMaxFiles && (
        <div className="mt-2">
          <Button
            variant="outline"
            onClick={onUpload}
            disabled={files.some((file) => file.errors.length !== 0) || loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <Trans i18nKey="common:dropzone.uploading" />
              </>
            ) : (
              <span className="flex items-center">
                <Upload size={20} className="mr-2 h-4 w-4" />

                <Trans
                  i18nKey="common:dropzone.uploadFiles"
                  values={{
                    count: files.length,
                  }}
                />
              </span>
            )}
          </Button>
        </div>
      )}
    </div>
  );
};

const DropzoneEmptyState = ({ className }: { className?: string }) => {
  const { maxFiles, maxFileSize, inputRef, isSuccess } = useDropzoneContext();

  if (isSuccess) {
    return null;
  }

  return (
    <div className={cn('flex flex-col items-center gap-y-2', className)}>
      <Upload size={20} className="text-muted-foreground" />

      <p className="text-sm">
        <Trans
          i18nKey="common:dropzone.uploadFiles"
          values={{ count: maxFiles }}
        />
      </p>

      <div className="flex flex-col items-center gap-y-1">
        <p className="text-xs text-muted-foreground">
          <Trans i18nKey="common:dropzone.dragAndDrop" />{' '}
          <a
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer underline transition hover:text-foreground"
          >
            <Trans
              i18nKey="common:dropzone.select"
              values={{ count: maxFiles === 1 ? `file` : 'files' }}
            />
          </a>{' '}
          <Trans i18nKey="common:dropzone.toUpload" />
        </p>

        {maxFileSize !== Number.POSITIVE_INFINITY && (
          <p className="text-xs text-muted-foreground">
            <Trans
              i18nKey="common:dropzone.maxFileSize"
              values={{ size: formatBytes(maxFileSize, 2) }}
            />
          </p>
        )}
      </div>
    </div>
  );
};

const useDropzoneContext = () => {
  const context = useContext(DropzoneContext);

  if (!context) {
    throw new Error('useDropzoneContext must be used within a Dropzone');
  }

  return context;
};

export { Dropzone, DropzoneContent, DropzoneEmptyState, useDropzoneContext };
