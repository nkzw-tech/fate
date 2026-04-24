import { fate, router } from '../init.ts';
import { tagDataView } from '../views.ts';

export const tagRouter = router(
  fate.procedures({
    list: false,
    view: tagDataView,
  }),
);
