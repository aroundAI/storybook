'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@kit/ui/table';
import { Badge } from '@kit/ui/badge';
import { PlayCircle, FastForward, StopCircle, Video, Package, Layers, PlusCircle, Trash2, CheckCircle } from 'lucide-react';

interface SponsorTrackerProps {
  slots: Array<{
    id: string;
    brandName: string;
    brandLogoUrl: string | null;
    campaignName: string | null;
    slotType: string;
    startSeconds: number | null;
    endSeconds: number | null;
    durationSeconds: number | null;
    rateCents: number | null;
    rateType: string;
    currency: string;
    isPaid: boolean;
    status: string;
    episodeTitle: string;
    ctaUrl: string | null;
    promoCode: string | null;
  }>;
  revenueSummary: {
    totalRevenueCents: number;
    paidCents: number;
    unpaidCents: number;
    slotCount: number;
  };
  onCreateSlot: () => void;
  onUpdateSlot: (slotId: string, updates: Record<string, unknown>) => Promise<void>;
  onDeleteSlot: (slotId: string) => Promise<void>;
  onMarkPaid: (slotId: string) => Promise<void>;
}

const SlotTypeIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'pre_roll': return <PlayCircle className="h-4 w-4" />;
    case 'mid_roll': return <FastForward className="h-4 w-4" />;
    case 'post_roll': return <StopCircle className="h-4 w-4" />;
    case 'dedicated': return <Video className="h-4 w-4" />;
    case 'product_placement': return <Package className="h-4 w-4" />;
    case 'overlay': return <Layers className="h-4 w-4" />;
    default: return <Video className="h-4 w-4" />;
  }
};

const StatusBadge = ({ status }: { status: string }) => {
  switch (status) {
    case 'draft': return <Badge variant="secondary" className="bg-gray-100 text-gray-800">Draft</Badge>;
    case 'confirmed': return <Badge variant="secondary" className="bg-blue-100 text-blue-800">Confirmed</Badge>;
    case 'recorded': return <Badge variant="secondary" className="bg-amber-100 text-amber-800">Recorded</Badge>;
    case 'published': return <Badge variant="secondary" className="bg-violet-100 text-violet-800">Published</Badge>;
    case 'completed': return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">Completed</Badge>;
    case 'cancelled': return <Badge variant="destructive">Cancelled</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
};

export function SponsorTracker({
  slots,
  revenueSummary,
  onCreateSlot,
  onDeleteSlot,
  onMarkPaid,
}: SponsorTrackerProps) {
  const formatCurrency = (valueInCents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(valueInCents / 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Sponsor Tracker</h2>
          <p className="text-muted-foreground">
            Manage your sponsorships, slot placements, and revenue.
          </p>
        </div>
        <Button onClick={onCreateSlot}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Sponsor Slot
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(revenueSummary.totalRevenueCents)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Paid</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{formatCurrency(revenueSummary.paidCents)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unpaid</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{formatCurrency(revenueSummary.unpaidCents)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Slots</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{revenueSummary.slotCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead>Episode</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slots.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                    No sponsor slots found.
                  </TableCell>
                </TableRow>
              ) : (
                slots.map((slot) => (
                  <TableRow key={slot.id}>
                    <TableCell className="font-medium">
                      {slot.brandName}
                      {slot.campaignName && <div className="text-xs text-muted-foreground">{slot.campaignName}</div>}
                    </TableCell>
                    <TableCell>{slot.episodeTitle}</TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <SlotTypeIcon type={slot.slotType} />
                        <span className="capitalize">{slot.slotType.replace('_', ' ')}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {slot.rateCents ? formatCurrency(slot.rateCents) : '-'}
                      <div className="text-xs text-muted-foreground capitalize">{slot.rateType.replace('_', ' ')}</div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={slot.status} />
                    </TableCell>
                    <TableCell>
                      {slot.isPaid ? (
                        <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50">Paid</Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">Unpaid</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        {!slot.isPaid && (
                          <Button variant="ghost" size="icon" onClick={() => onMarkPaid(slot.id)} title="Mark Paid">
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="text-red-600" onClick={() => onDeleteSlot(slot.id)} title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
