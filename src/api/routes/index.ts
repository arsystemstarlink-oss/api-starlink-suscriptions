import { Router } from "express";
import { clientRouter } from "./clientRoutes.js";
import { subscriptionRouter } from "./subscriptionRoutes.js";
import { paymentRouter } from "./paymentRoutes.js";
import { cronRouter } from "./cronRoutes.js";
import { planRouter } from "./planRoutes.js";
import { communicationRouter as communicationsRouter } from "./communicationRoutes.js";
import { clientPortalRouter } from "./clientPortalRoutes.js";

const apiRouter = Router();

apiRouter.use("/clients", clientRouter);
apiRouter.use("/plans", planRouter);
apiRouter.use("/subscriptions", subscriptionRouter);
apiRouter.use("/payments", paymentRouter);
apiRouter.use("/cron", cronRouter);
apiRouter.use("/communications", communicationsRouter);
apiRouter.use("/client", clientPortalRouter);

export { apiRouter };
