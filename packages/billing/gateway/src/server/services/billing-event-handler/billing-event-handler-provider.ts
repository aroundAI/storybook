import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { PlanTypeMap } from '@kit/billing';
import { Database, Enums } from '@kit/supabase/database';

import { createBillingEventHandlerFactoryService } from './billing-event-handler-factory.service';
import { createBillingEventHandlerService } from './billing-event-handler.service';

// a function that returns a Supabase client
type ClientProvider = () => SupabaseClient<Database>;

// the billing provider from the database
type BillingProvider = Enums<'billing_provider'>;

/**
 * @name getBillingEventHandlerService
 * @description This function retrieves the billing provider from the database and returns a
 * new instance of the `BillingGatewayService` class. This class is used to interact with the server actions
 * defined in the host application.
 */
export async function getBillingEventHandlerService(
  clientProvider: ClientProvider,
  provider: BillingProvider,
  planTypesMap: PlanTypeMap,
) {
  const strategy =
    await createBillingEventHandlerFactoryService(planTypesMap).get(provider);

  return createBillingEventHandlerService(clientProvider, strategy);
}
