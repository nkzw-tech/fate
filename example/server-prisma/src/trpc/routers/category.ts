import { router } from '../init.ts';
import { sourceProcedures } from '../sourceRouter.ts';
import { categorySource } from '../views.ts';

export const categoryRouter = router(sourceProcedures(categorySource));
