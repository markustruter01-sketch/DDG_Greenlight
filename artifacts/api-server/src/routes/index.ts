import { Router, type IRouter } from "express";
import healthRouter from "./health";
import greenlightRouter from "./greenlight";

const router: IRouter = Router();

router.use(healthRouter);
router.use(greenlightRouter);

export default router;
