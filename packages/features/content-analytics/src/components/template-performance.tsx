'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@kit/ui/table';
import { Badge } from '@kit/ui/badge';
import { PlusCircle, RefreshCw } from 'lucide-react';

interface TemplatePerformanceProps {
  versions: Array<{
    id: string;
    templateName: string;
    versionNumber: number;
    versionLabel: string | null;
    isActive: boolean;
    usageCount: number;
    performanceAggregate: {
      avgViews: number;
      avgLikes: number;
      avgWatchTime: number;
      avgRetention: number;
      avgRevenue: number;
      episodeCount: number;
    };
    createdAt: string;
  }>;
  onCreateVersion: () => void;
  onActivateVersion: (versionId: string) => Promise<void>;
  onRecalculate: () => Promise<void>;
}

export function TemplatePerformance({
  versions,
  onCreateVersion,
  onActivateVersion,
  onRecalculate,
}: TemplatePerformanceProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Template Performance</h2>
          <p className="text-muted-foreground">
            Compare performance metrics across different versions of your prompt templates.
          </p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={onRecalculate}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Recalculate
          </Button>
          <Button onClick={onCreateVersion}>
            <PlusCircle className="mr-2 h-4 w-4" />
            New Version
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
          <CardDescription>All versions for this template.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Usage Count</TableHead>
                <TableHead className="text-right">Avg Views</TableHead>
                <TableHead className="text-right">Avg Likes</TableHead>
                <TableHead className="text-right">Avg Revenue</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                    No template versions found.
                  </TableCell>
                </TableRow>
              ) : (
                versions.map((version) => (
                  <TableRow key={version.id}>
                    <TableCell className="font-medium">v{version.versionNumber}</TableCell>
                    <TableCell>{version.versionLabel || '-'}</TableCell>
                    <TableCell>
                      {version.isActive ? (
                        <Badge variant="default">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(version.usageCount)}</TableCell>
                    <TableCell className="text-right">{formatNumber(version.performanceAggregate.avgViews)}</TableCell>
                    <TableCell className="text-right">{formatNumber(version.performanceAggregate.avgLikes)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(version.performanceAggregate.avgRevenue)}</TableCell>
                    <TableCell className="text-right">
                      {!version.isActive && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => onActivateVersion(version.id)}
                        >
                          Make Active
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
