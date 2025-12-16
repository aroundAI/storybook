'use client';

import { useEffect, useState } from 'react';

import { MapPin, User } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { useSupabase } from '@kit/supabase/hooks/use-supabase';

interface TaggedAssetsProps {
    characterIds: string[];
    locationIds: string[];
}

interface Asset {
    id: string;
    name: string;
    type: string;
}

export function TaggedAssets({ characterIds, locationIds }: TaggedAssetsProps) {
    const supabase = useSupabase();
    const [characters, setCharacters] = useState<Asset[]>([]);
    const [locations, setLocations] = useState<Asset[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchAssets = async () => {
            setIsLoading(true);

            const allAssetIds = [...characterIds, ...locationIds];

            if (allAssetIds.length === 0) {
                setIsLoading(false);
                return;
            }

            const { data, error } = await supabase
                .from('assets')
                .select('id, name, type')
                .in('id', allAssetIds);

            if (!error && data) {
                setCharacters(data.filter((a) => a.type === 'character'));
                setLocations(data.filter((a) => a.type === 'location'));
            }

            setIsLoading(false);
        };

        void fetchAssets();
    }, [characterIds, locationIds, supabase]);

    if (isLoading || (characters.length === 0 && locations.length === 0)) {
        return null;
    }

    return (
        <div className="flex flex-wrap gap-2">
            {characters.map((char) => (
                <Badge key={char.id} variant="secondary" className="gap-1">
                    <User className="h-3 w-3" />
                    {char.name}
                </Badge>
            ))}
            {locations.map((loc) => (
                <Badge key={loc.id} variant="outline" className="gap-1">
                    <MapPin className="h-3 w-3" />
                    {loc.name}
                </Badge>
            ))}
        </div>
    );
}
