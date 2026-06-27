import { useState } from 'react';

import { Calendar } from '@kit/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

export function Default() {
  const [date, setDate] = useState<Date | undefined>(new Date('2026-06-18'));

  return (
    <Card className="w-fit">
      <CardHeader>
        <CardTitle className="text-sm">Publish date</CardTitle>
      </CardHeader>
      <CardContent>
        <Calendar
          mode="single"
          selected={date}
          onSelect={setDate}
          className="rounded-md border"
        />
      </CardContent>
    </Card>
  );
}

export function Range() {
  const [range, setRange] = useState<{ from: Date; to: Date } | undefined>({
    from: new Date('2026-06-15'),
    to: new Date('2026-06-22'),
  });

  return (
    <Card className="w-fit">
      <CardHeader>
        <CardTitle className="text-sm">Season 2 release window</CardTitle>
      </CardHeader>
      <CardContent>
        <Calendar
          mode="range"
          selected={range}
          onSelect={setRange}
          className="rounded-md border"
        />
      </CardContent>
    </Card>
  );
}
