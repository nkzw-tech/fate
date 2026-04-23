import { router } from '../init.ts';
import { sourceProcedures } from '../sourceRouter.ts';
import { tagSource } from '../views.ts';

export const tagRouter = router(
  sourceProcedures({
    list: false,
    source: tagSource,
  }),
);
