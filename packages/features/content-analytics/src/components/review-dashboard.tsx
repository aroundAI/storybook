'use client';

import * as React from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@kit/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { Textarea } from '@kit/ui/textarea';
import { Checkbox } from '@kit/ui/checkbox';
import { Progress } from '@kit/ui/progress';
import { 
  ClipboardCheck, TrendingUp, TrendingDown, Clock, Eye, ThumbsUp, 
  MessageCircle, Share2, DollarSign, AlertTriangle, CheckCircle2, SkipForward, X 
} from 'lucide-react';

interface ActionItem {
  title: string;
  completed: boolean;
}

interface ReviewPerformanceSnapshot {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTimeSeconds: number;
  subscribersGained: number;
  revenueCents: number;
}

interface ReviewDashboardProps {
  reviews: Array<{
    id: string;
    episodeTitle: string;
    publishTitle: string;
    platform: string;
    language: string;
    reviewType: string;
    reviewDueAt: string;
    status: string;
    verdict: string | null;
    performanceSnapshot: ReviewPerformanceSnapshot;
    benchmarks: {
      projectAvg: Record<string, number>;
      percentileRank: number;
    };
    actionItems: ActionItem[];
  }>;
  summary: { pending: number; inReview: number; completed: number; skipped: number };
  onSelectReview: (reviewId: string) => void;
  onGenerateReviews: () => Promise<void>;
  onCompleteReview: (reviewId: string, data: { verdict: string; notes: string; actionItems: ActionItem[] }) => Promise<void>;
  onSkipReview: (reviewId: string) => Promise<void>;
}

export function ReviewDashboard({
  reviews,
  summary,
  onSelectReview,
  onGenerateReviews,
  onCompleteReview,
  onSkipReview
}: ReviewDashboardProps) {
  const [activeTab, setActiveTab] = React.useState('pending');
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [selectedReview, setSelectedReview] = React.useState<string | null>(null);
  
  // Review form state
  const [formVerdict, setFormVerdict] = React.useState('on_track');
  const [formNotes, setFormNotes] = React.useState('');
  const [formActionItems, setFormActionItems] = React.useState<ActionItem[]>([]);
  const [newActionItem, setNewActionItem] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      await onGenerateReviews();
    } finally {
      setIsGenerating(false);
    }
  };
  
  const handleOpenReview = (reviewId: string) => {
    const review = reviews.find(r => r.id === reviewId);
    if (review) {
      setFormVerdict(review.verdict || 'on_track');
      setFormNotes('');
      setFormActionItems(review.actionItems || []);
      setSelectedReview(reviewId);
      onSelectReview(reviewId);
    }
  };
  
  const handleAddActionItem = () => {
    if (newActionItem.trim()) {
      setFormActionItems([...formActionItems, { title: newActionItem.trim(), completed: false }]);
      setNewActionItem('');
    }
  };
  
  const handleRemoveActionItem = (index: number) => {
    setFormActionItems(formActionItems.filter((_, i) => i !== index));
  };
  
  const handleToggleActionItem = (index: number) => {
    const newItems = [...formActionItems];
    newItems[index] = { ...newItems[index], completed: !newItems[index].completed };
    setFormActionItems(newItems);
  };
  
  const handleComplete = async () => {
    if (selectedReview) {
      setIsSubmitting(true);
      try {
        await onCompleteReview(selectedReview, {
          verdict: formVerdict,
          notes: formNotes,
          actionItems: formActionItems
        });
        setSelectedReview(null);
      } finally {
        setIsSubmitting(false);
      }
    }
  };
  
  const handleSkip = async () => {
    if (selectedReview) {
      setIsSubmitting(true);
      try {
        await onSkipReview(selectedReview);
        setSelectedReview(null);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const formatNumber = (num: number) => new Intl.NumberFormat('en-US', { notation: 'compact' }).format(num || 0);
  const formatCurrency = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
  const formatDuration = (seconds: number) => {
    if (!seconds) return '0h 0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const filteredReviews = reviews.filter(r => {
    if (activeTab === 'pending') return r.status === 'pending' || r.status === 'in_review';
    return r.status === activeTab;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Day-30 Reviews</h2>
          <p className="text-muted-foreground">Review content performance at the 30-day milestone.</p>
        </div>
        <Button onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? 'Scanning...' : 'Generate Reviews'}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{summary.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Review</CardTitle>
            <Eye className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{summary.inReview}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{summary.completed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Skipped</CardTitle>
            <SkipForward className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">{summary.skipped}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="pending" value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="skipped">Skipped</TabsTrigger>
        </TabsList>
        
        <TabsContent value={activeTab} className="space-y-4 mt-4">
          {filteredReviews.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-md border border-dashed">
              <p className="text-sm text-muted-foreground">No reviews in this category.</p>
            </div>
          ) : (
            filteredReviews.map(review => (
              <Card key={review.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg line-clamp-1">{review.publishTitle || review.episodeTitle}</CardTitle>
                      <CardDescription className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">{review.platform}</Badge>
                        <Badge variant="secondary" className="text-xs">{review.language}</Badge>
                        <span className="text-xs flex items-center">
                          <Clock className="h-3 w-3 mr-1" />
                          Due: {formatDistanceToNow(new Date(review.reviewDueAt), { addSuffix: true })}
                        </span>
                      </CardDescription>
                    </div>
                    {review.verdict && (
                      <Badge variant={
                        review.verdict === 'outperforming' ? 'default' :
                        review.verdict === 'on_track' ? 'secondary' :
                        review.verdict === 'underperforming' ? 'destructive' :
                        'outline'
                      }>
                        {review.verdict.replace('_', ' ').toUpperCase()}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pb-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="flex flex-col">
                      <span className="text-muted-foreground text-xs flex items-center"><Eye className="h-3 w-3 mr-1" />Views</span>
                      <span className="font-semibold">{formatNumber(review.performanceSnapshot?.views)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground text-xs flex items-center"><ThumbsUp className="h-3 w-3 mr-1" />Likes</span>
                      <span className="font-semibold">{formatNumber(review.performanceSnapshot?.likes)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground text-xs flex items-center"><Clock className="h-3 w-3 mr-1" />Watch Time</span>
                      <span className="font-semibold">{formatDuration(review.performanceSnapshot?.watchTimeSeconds)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground text-xs flex items-center"><DollarSign className="h-3 w-3 mr-1" />Revenue</span>
                      <span className="font-semibold">{formatCurrency(review.performanceSnapshot?.revenueCents)}</span>
                    </div>
                  </div>
                  
                  {review.benchmarks?.percentileRank !== undefined && (
                    <div className="mt-4 flex items-center justify-between">
                      <span className="text-xs font-medium">Percentile Rank vs Project</span>
                      <span className="text-xs font-bold">{review.benchmarks.percentileRank}th</span>
                    </div>
                  )}
                  {review.benchmarks?.percentileRank !== undefined && (
                    <Progress value={review.benchmarks.percentileRank} className="h-2 mt-1" />
                  )}
                </CardContent>
                <CardFooter className="bg-muted/50 py-3 flex justify-between">
                  <div className="text-xs text-muted-foreground">
                    {review.actionItems?.length ? `${review.actionItems.filter(i => i.completed).length}/${review.actionItems.length} action items` : 'No action items'}
                  </div>
                  <Dialog open={selectedReview === review.id} onOpenChange={(open) => !open && setSelectedReview(null)}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" onClick={() => handleOpenReview(review.id)}>
                        {activeTab === 'pending' ? 'Conduct Review' : 'View Details'}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Day-30 Review: {review.publishTitle || review.episodeTitle}</DialogTitle>
                        <DialogDescription>
                          Review performance metrics and establish action items.
                        </DialogDescription>
                      </DialogHeader>
                      
                      <div className="space-y-6 py-4">
                        {/* Performance Details */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold flex items-center"><TrendingUp className="h-4 w-4 mr-2" />Performance vs Benchmarks</h4>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="border rounded p-2 flex flex-col items-center justify-center bg-muted/30">
                              <span className="text-xs text-muted-foreground">Views</span>
                              <span className="font-bold">{formatNumber(review.performanceSnapshot?.views)}</span>
                              {review.benchmarks?.projectAvg?.views ? (
                                <span className={`text-[10px] ${(review.performanceSnapshot?.views || 0) >= review.benchmarks.projectAvg.views ? 'text-green-600' : 'text-red-500'}`}>
                                  vs avg {formatNumber(review.benchmarks.projectAvg.views)}
                                </span>
                              ) : null}
                            </div>
                            <div className="border rounded p-2 flex flex-col items-center justify-center bg-muted/30">
                              <span className="text-xs text-muted-foreground">Likes</span>
                              <span className="font-bold">{formatNumber(review.performanceSnapshot?.likes)}</span>
                              {review.benchmarks?.projectAvg?.likes ? (
                                <span className={`text-[10px] ${(review.performanceSnapshot?.likes || 0) >= review.benchmarks.projectAvg.likes ? 'text-green-600' : 'text-red-500'}`}>
                                  vs avg {formatNumber(review.benchmarks.projectAvg.likes)}
                                </span>
                              ) : null}
                            </div>
                            <div className="border rounded p-2 flex flex-col items-center justify-center bg-muted/30">
                              <span className="text-xs text-muted-foreground">Comments</span>
                              <span className="font-bold">{formatNumber(review.performanceSnapshot?.comments)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Verdict Selection */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold flex items-center"><ClipboardCheck className="h-4 w-4 mr-2" />Verdict</h4>
                          <Select value={formVerdict} onValueChange={setFormVerdict}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select verdict" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="outperforming">Outperforming (Top 20%)</SelectItem>
                              <SelectItem value="on_track">On Track (Middle 60%)</SelectItem>
                              <SelectItem value="underperforming">Underperforming (Bottom 20%)</SelectItem>
                              <SelectItem value="needs_attention">Needs Immediate Attention</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Notes */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold">Notes & Observations</h4>
                          <Textarea 
                            placeholder="What went well? What could be improved for next time?" 
                            value={formNotes}
                            onChange={(e) => setFormNotes(e.target.value)}
                            rows={3}
                          />
                        </div>

                        {/* Action Items */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold">Action Items</h4>
                          <div className="space-y-2">
                            {formActionItems.map((item, index) => (
                              <div key={index} className="flex items-center space-x-2 border p-2 rounded">
                                <Checkbox 
                                  id={`action-${index}`} 
                                  checked={item.completed}
                                  onCheckedChange={() => handleToggleActionItem(index)}
                                />
                                <label 
                                  htmlFor={`action-${index}`}
                                  className={`text-sm font-medium leading-none flex-grow ${item.completed ? 'line-through text-muted-foreground' : ''}`}
                                >
                                  {item.title}
                                </label>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => handleRemoveActionItem(index)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                            <div className="flex items-center space-x-2 pt-2">
                              <Textarea 
                                placeholder="Add new action item (e.g. Update thumbnail, A/B test title)" 
                                value={newActionItem}
                                onChange={(e) => setNewActionItem(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleAddActionItem();
                                  }
                                }}
                                className="min-h-[40px] resize-none"
                                rows={1}
                              />
                              <Button type="button" size="sm" onClick={handleAddActionItem}>Add</Button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <DialogFooter className="flex justify-between sm:justify-between items-center">
                        <Button 
                          variant="ghost" 
                          className="text-muted-foreground"
                          onClick={handleSkip}
                          disabled={isSubmitting}
                        >
                          Skip Review
                        </Button>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => setSelectedReview(null)} disabled={isSubmitting}>Cancel</Button>
                          <Button onClick={handleComplete} disabled={isSubmitting}>
                            {isSubmitting ? 'Saving...' : 'Complete Review'}
                          </Button>
                        </div>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardFooter>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
