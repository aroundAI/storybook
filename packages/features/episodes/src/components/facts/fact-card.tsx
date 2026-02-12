'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
    Check,
    ClipboardCopy,
    ExternalLink,
    MoreHorizontal,
    Pencil,
    Trash2,
} from 'lucide-react';
import { toast } from '@kit/ui/sonner';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
    Card,
    CardContent,
} from '@kit/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

import type { MappedFact } from '../../server/fact-actions';

import { STATUS_LABELS, STATUS_STYLES } from './fact-constants';

interface FactCardProps {
    fact: MappedFact;
    basePath: string;
    onVerify?: () => void;
    onDelete?: () => void;
}

export function FactCard({ fact, basePath, onVerify, onDelete }: FactCardProps) {
    const router = useRouter();

    const handleCopyClaim = async () => {
        try {
            await navigator.clipboard.writeText(fact.claim);
            toast.success('Claim copied to clipboard');
        } catch {
            toast.error('Failed to copy claim');
        }
    };

    return (
        <Card className="transition-shadow hover:shadow-md">
            <CardContent className="p-4">
                <div className="flex justify-between items-start gap-4">
                    {/* Left: claim, citation, tags */}
                    <div className="flex-1 min-w-0">
                        <Link
                            href={`${basePath}/${fact.id}`}
                            className="font-medium text-foreground hover:underline line-clamp-2"
                        >
                            {fact.claim}
                        </Link>

                        {fact.sourceCitation && (
                            <p className="text-sm text-muted-foreground mt-1.5 line-clamp-1">
                                {fact.sourceCitation}
                            </p>
                        )}

                        {fact.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                                {fact.tags.map((tag) => (
                                    <Badge key={tag} variant="secondary" className="text-xs">
                                        {tag}
                                    </Badge>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Right: status, confidence, actions */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <Badge
                            className={
                                STATUS_STYLES[fact.verificationStatus] ??
                                STATUS_STYLES.unverified
                            }
                        >
                            {STATUS_LABELS[fact.verificationStatus] ??
                                fact.verificationStatus}
                        </Badge>

                        {fact.confidenceScore != null && (
                            <span className="text-xs text-muted-foreground">
                                {Math.round(fact.confidenceScore * 100)}% confident
                            </span>
                        )}

                        <span className="text-xs text-muted-foreground">
                            Used {fact.timesUsed}×
                        </span>
                    </div>
                </div>

                {/* Actions row */}
                <div className="flex items-center gap-1 mt-3 pt-3 border-t">
                    <Button variant="ghost" size="sm" asChild>
                        <Link href={`${basePath}/${fact.id}`}>Details</Link>
                    </Button>

                    {fact.verificationStatus === 'unverified' && onVerify && (
                        <Button variant="ghost" size="sm" onClick={onVerify}>
                            <Check className="h-3.5 w-3.5 mr-1" />
                            Verify
                        </Button>
                    )}

                    {fact.sourceUrl && (
                        <Button variant="ghost" size="sm" asChild>
                            <a
                                href={fact.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                                Source
                            </a>
                        </Button>
                    )}

                    <div className="ml-auto">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                    onClick={() => router.push(`${basePath}/${fact.id}`)}
                                >
                                    <Pencil className="h-4 w-4 mr-2" />
                                    Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleCopyClaim}>
                                    <ClipboardCopy className="h-4 w-4 mr-2" />
                                    Copy Claim
                                </DropdownMenuItem>
                                {onDelete && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={onDelete}
                                            className="text-destructive"
                                        >
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Delete
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
