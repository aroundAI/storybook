'use client';

import { createContext, useContext, useState } from 'react';

type AssetCreateType = 'character' | 'location';

interface AssetCreateContextValue {
  creating: AssetCreateType | null;
  openCreate: (type: AssetCreateType) => void;
  closeCreate: () => void;
}

const AssetCreateContext = createContext<AssetCreateContextValue | null>(null);

export function AssetCreateProvider({ children }: React.PropsWithChildren) {
  const [creating, setCreating] = useState<AssetCreateType | null>(null);

  return (
    <AssetCreateContext.Provider
      value={{
        creating,
        openCreate: setCreating,
        closeCreate: () => setCreating(null),
      }}
    >
      {children}
    </AssetCreateContext.Provider>
  );
}

export function useAssetCreate() {
  const context = useContext(AssetCreateContext);

  if (!context) {
    throw new Error('useAssetCreate must be used within AssetCreateProvider');
  }

  return context;
}
