import { fate, router } from '../init.ts';
import { categoryDataView } from '../views.ts';

export const categoryRouter = router(fate.procedures(categoryDataView));
