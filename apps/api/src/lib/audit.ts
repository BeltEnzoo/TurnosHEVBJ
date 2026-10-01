import type { Prisma, PrismaClient } from "@hep/db";

type AuditDb = PrismaClient | Prisma.TransactionClient;

type AuditInput = {
  actorUserId?: string | null;
  actorType: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ipHash?: string | null;
  userAgentTruncated?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAudit(prisma: AuditDb, input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      ipHash: input.ipHash ?? null,
      userAgentTruncated: input.userAgentTruncated ?? null,
      metadata: input.metadata,
    },
  });
}
