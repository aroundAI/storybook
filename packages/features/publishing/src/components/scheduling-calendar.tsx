'use client';

import { useState } from 'react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  isToday 
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';
import { cn } from '@kit/ui/utils';

interface SchedulingCalendarProps {
  items: Array<{
    id: string;
    title: string;
    scheduledAt: Date;
    platform: string;
    contentType: 'full' | 'short';
    language?: string;
    status: 'draft' | 'scheduled' | 'published' | 'failed';
  }>;
  onReschedule?: (itemId: string, newDate: Date) => void;
  onItemClick?: (itemId: string) => void;
}

export function SchedulingCalendar({ items, onItemClick }: SchedulingCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  
  // Need to pad start of month with previous month days to align with week
  const startDate = new Date(monthStart);
  startDate.setDate(startDate.getDate() - startDate.getDay()); // Start on Sunday

  const endDate = new Date(monthEnd);
  if (endDate.getDay() !== 6) {
    endDate.setDate(endDate.getDate() + (6 - endDate.getDay())); // End on Saturday
  }

  const dateRange = eachDayOfInterval({ start: startDate, end: endDate });

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-xl font-bold">
          {format(currentDate, 'MMMM yyyy')}
        </CardTitle>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center space-x-4 text-sm">
          <div className="flex items-center">
            <div className="mr-2 h-3 w-3 rounded-full bg-blue-500" />
            <span>Full Video</span>
          </div>
          <div className="flex items-center">
            <div className="mr-2 h-3 w-3 rounded-full bg-pink-500" />
            <span>Short</span>
          </div>
        </div>
        
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map(day => (
            <div key={day} className="py-2 text-center text-sm font-medium text-muted-foreground">
              {day}
            </div>
          ))}
          
          {dateRange.map((day, i) => {
            const dayItems = items.filter(item => isSameDay(item.scheduledAt, day));
            const isCurrentMonth = isSameMonth(day, currentDate);
            
            return (
              <div 
                key={i} 
                className={cn(
                  "min-h-[100px] rounded-md border p-2 transition-colors",
                  !isCurrentMonth && "bg-muted/50 text-muted-foreground",
                  isToday(day) && "border-primary/50 bg-primary/5"
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    {format(day, 'd')}
                  </span>
                  {dayItems.length > 0 && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {dayItems.length}
                    </Badge>
                  )}
                </div>
                
                <div className="flex flex-col space-y-1">
                  {dayItems.map(item => (
                    <TooltipProvider key={item.id}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div 
                            className={cn(
                              "cursor-pointer truncate rounded px-1.5 py-0.5 text-xs text-white shadow-sm transition-opacity hover:opacity-80",
                              item.contentType === 'full' ? "bg-blue-500" : "bg-pink-500",
                              item.status === 'published' && "opacity-60 grayscale",
                              item.status === 'failed' && "bg-red-500"
                            )}
                            onClick={() => onItemClick?.(item.id)}
                          >
                            {format(item.scheduledAt, 'HH:mm')} - {item.title}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-sm">
                            <p className="font-bold">{item.title}</p>
                            <p>Platform: {item.platform}</p>
                            {item.language && <p>Language: {item.language}</p>}
                            <p>Status: <span className="capitalize">{item.status}</span></p>
                            <p>Type: <span className="capitalize">{item.contentType}</span></p>
                            <p>Time: {format(item.scheduledAt, 'MMM d, h:mm a')}</p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                  
                  {dayItems.length === 0 && isCurrentMonth && (
                    <div className="text-center text-xs text-muted-foreground opacity-50">
                      -
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
