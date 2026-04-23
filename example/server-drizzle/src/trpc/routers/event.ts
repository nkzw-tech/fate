import { router } from '../init.ts';
import { sourceProcedures } from '../sourceRouter.ts';
import { eventSource } from '../views.ts';

export const eventRouter = router(
  sourceProcedures({
    list: { defaultSize: 3 },
    source: eventSource,
  }),
);
