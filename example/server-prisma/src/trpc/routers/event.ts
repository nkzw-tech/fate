import { fate, router } from '../init.ts';
import { eventDataView } from '../views.ts';

export const eventRouter = router(
  fate.procedures({
    list: { defaultSize: 3 },
    view: eventDataView,
  }),
);
