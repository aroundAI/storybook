'use client';

import { useMemo } from 'react';

import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import type { LineItemSchema } from '@kit/billing';
import { formatCurrency } from '@kit/shared/utils';
import { Trans } from '@kit/ui/trans';

type PlanCostDisplayProps = {
  primaryLineItem: z.infer<typeof LineItemSchema>;
  currencyCode: string;
  interval?: string;
  alwaysDisplayMonthlyPrice?: boolean;
  className?: string;
};

/**
 * @name PlanCostDisplay
 * @description
 * This component is used to display the cost of a plan. It will handle
 * the display of the cost for metered plans by using the lowest tier using the format "Starting at {price} {unit}"
 */
export function PlanCostDisplay({
  primaryLineItem,
  currencyCode,
  interval,
  alwaysDisplayMonthlyPrice = true,
  className,
}: PlanCostDisplayProps) {
  const { i18n } = useTranslation();

  const { shouldDisplayTier, lowestTier, tierTranslationKey, displayCost } =
    useMemo(() => {
      const shouldDisplayTier =
        primaryLineItem.type === 'metered' &&
        Array.isArray(primaryLineItem.tiers) &&
        primaryLineItem.tiers.length > 0;

      const isMultiTier =
        Array.isArray(primaryLineItem.tiers) &&
        primaryLineItem.tiers.length > 1;

      const lowestTier = primaryLineItem.tiers?.reduce((acc, curr) => {
        if (acc && acc.cost < curr.cost) {
          return acc;
        }
        return curr;
      }, primaryLineItem.tiers?.[0]);

      const isYearlyPricing = interval === 'year';

      const cost =
        isYearlyPricing && alwaysDisplayMonthlyPrice
          ? Number(primaryLineItem.cost / 12)
          : primaryLineItem.cost;

      return {
        shouldDisplayTier,
        isMultiTier,
        lowestTier,
        tierTranslationKey: isMultiTier
          ? 'billing:startingAtPriceUnit'
          : 'billing:priceUnit',
        displayCost: cost,
      };
    }, [primaryLineItem, interval, alwaysDisplayMonthlyPrice]);

  if (shouldDisplayTier) {
    const formattedCost = formatCurrency({
      currencyCode: currencyCode.toLowerCase(),
      value: lowestTier?.cost ?? 0,
      locale: i18n.language,
    });

    return (
      <span className={'text-lg'}>
        <Trans
          i18nKey={tierTranslationKey}
          values={{
            price: formattedCost,
            unit: primaryLineItem.unit,
          }}
        />
      </span>
    );
  }

  const formattedCost = formatCurrency({
    currencyCode: currencyCode.toLowerCase(),
    value: displayCost,
    locale: i18n.language,
  });

  return <span className={className}>{formattedCost}</span>;
}
