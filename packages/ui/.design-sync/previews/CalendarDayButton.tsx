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
