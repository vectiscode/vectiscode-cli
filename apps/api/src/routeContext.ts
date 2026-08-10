import type express from "express";
import type { RequestHandler } from "express";
import type { store } from "./services/store.js";
import type { socketService } from "./services/socket.js";
import type { KeyedMutex } from "./services/limits.js";
import type { Organization, Project, StudioSession, ChangeSet, User } from "./types.js";

export interface RouteContext {
  nanoid: (size?: number) => string;
  store: typeof store;
  socketService: typeof socketService;
  orgLocks: KeyedMutex;
  authLimiter: RequestHandler;
  aiLimiter: RequestHandler;
  billingLimiter: RequestHandler;
  subscribeLimiter: RequestHandler;
  studioPairLimiter: RequestHandler;
  studioClaimLimiter: RequestHandler;
  marketplaceLimiter: RequestHandler;
  recordEvidence: (
    req: express.Request,
    input: {
      userId?: string;
      organizationId?: string;
      projectId?: string;
      threadId?: string;
      type: "auth" | "billing" | "usage" | "admin" | "attachment" | "image_generation" | "studio" | "deletion" | "client_error";
      action: string;
      status?: string;
      amountCredits?: number;
      stripeCustomerId?: string;
      stripeSubscriptionId?: string;
      stripeSessionId?: string;
      metadata?: Record<string, unknown>;
    }
  ) => Promise<void>;
  requireAdmin: (req: express.Request, res: express.Response) => Promise<User | undefined>;
  requireOwnedProject: (userId: string, projectId: string, res: express.Response) => Promise<{ organization: Organization; project: Project } | undefined>;
  requireOwnedChangeSet: (userId: string, changeSetId: string, res: express.Response) => Promise<{ organization: Organization; project: Project; changeSet: ChangeSet } | undefined>;
  requestIp: (req: express.Request) => string | undefined;
}
