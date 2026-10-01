import argon2 from "argon2";
import { Secret, TOTP } from "otpauth";
import { ERROR_CODES, SENSITIVE_ROLES, type RoleCode } from "@hep/shared";
import { isDevSeedLoginForbidden } from "@hep/config";
import type { AppEnv } from "@hep/config";
import type { PrismaClient } from "@hep/db";
import { writeAudit } from "../../lib/audit.js";
import {
  decryptString,
  encryptString,
  hmacSha256,
  randomToken,
  sha256,
} from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";

const INVALID = "Credenciales inválidas.";

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export class StaffAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
  ) {}

  async login(input: {
    email: string;
    password: string;
    ip: string;
    userAgent?: string;
  }): Promise<{
    token: string;
    mfaRequired: boolean;
    mfaEnrollmentRequired: boolean;
  }> {
    const email = input.email.trim().toLowerCase();
    if (isDevSeedLoginForbidden(email, this.env.NODE_ENV, this.env.SEED_ADMIN_EMAIL)) {
      throw new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, INVALID);
    }
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: true } }, mfa: true },
    });

    const fail = async (): Promise<never> => {
      if (user) {
        const attempts = user.failedLoginCount + 1;
        const locked =
          attempts >= this.env.LOGIN_MAX_ATTEMPTS
            ? new Date(Date.now() + this.env.LOGIN_LOCK_MINUTES * 60 * 1000)
            : null;
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: attempts, lockedUntil: locked },
        });
      }
      await writeAudit(this.prisma, {
        actorType: "staff",
        actorUserId: user?.id,
        action: "auth.login_failed",
        ipHash: sha256(input.ip),
        userAgentTruncated: input.userAgent?.slice(0, 180) ?? null,
        metadata: { emailHmac: hmacSha256(email, this.env.SESSION_SECRET) },
      });
      throw new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, INVALID);
    };

    if (!user || !user.isActive || user.deactivatedAt) {
      await fail();
    }
    const account = user!;
    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
      await fail();
    }
    const passwordOk = await argon2.verify(account.passwordHash, input.password).catch(() => false);
    if (!passwordOk) {
      await fail();
    }

    const roleCodes = account.roles.map((item) => item.role.code as RoleCode);
    const needsMfa = roleCodes.some((code) => SENSITIVE_ROLES.includes(code));
    const enrolled = Boolean(account.mfa?.confirmedAt);

    const token = randomToken();
    await this.prisma.session.create({
      data: {
        userId: account.id,
        tokenHash: sha256(token),
        kind: "STAFF",
        expiresAt: hoursFromNow(this.env.SESSION_IDLE_HOURS),
        absoluteExpiresAt: hoursFromNow(this.env.SESSION_ABSOLUTE_HOURS),
        ipHash: sha256(input.ip),
        userAgentTruncated: input.userAgent?.slice(0, 180) ?? null,
        mfaSatisfied: !needsMfa,
      },
    });
    await this.prisma.user.update({
      where: { id: account.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await writeAudit(this.prisma, {
      actorType: "staff",
      actorUserId: account.id,
      action: "auth.login",
      ipHash: sha256(input.ip),
    });

    return {
      token,
      mfaRequired: needsMfa && enrolled,
      mfaEnrollmentRequired: needsMfa && !enrolled,
    };
  }

  async startMfaEnrollment(userId: string, email: string): Promise<{ otpauthUrl: string }> {
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({
      issuer: this.env.HOSPITAL_NAME,
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });
    await this.prisma.mfaTotp.upsert({
      where: { userId },
      create: {
        userId,
        secretEncrypted: encryptString(secret.base32, this.env.FIELD_ENCRYPTION_KEY),
      },
      update: {
        secretEncrypted: encryptString(secret.base32, this.env.FIELD_ENCRYPTION_KEY),
        confirmedAt: null,
        recoveryCodeHashes: [],
      },
    });
    return { otpauthUrl: totp.toString() };
  }

  async confirmMfaEnrollment(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const row = await this.prisma.mfaTotp.findUnique({ where: { userId } });
    if (!row) {
      throw new AppError(400, ERROR_CODES.MFA_INVALID, "MFA no iniciado.");
    }
    this.assertTotp(row.secretEncrypted, code);
    const recoveryCodes = Array.from({ length: 8 }, () => randomToken(8));
    const recoveryCodeHashes = recoveryCodes.map((codeValue) => sha256(codeValue));
    await this.prisma.mfaTotp.update({
      where: { userId },
      data: { confirmedAt: new Date(), recoveryCodeHashes },
    });
    await writeAudit(this.prisma, {
      actorType: "staff",
      actorUserId: userId,
      action: "auth.mfa_enrolled",
    });
    return { recoveryCodes };
  }

  async verifyMfa(userId: string, sessionId: string, code: string): Promise<void> {
    const row = await this.prisma.mfaTotp.findUnique({ where: { userId } });
    if (!row?.confirmedAt) {
      throw new AppError(401, ERROR_CODES.MFA_INVALID, "MFA inválido.");
    }
    const usedRecovery = row.recoveryCodeHashes.includes(sha256(code));
    if (usedRecovery) {
      await this.prisma.mfaTotp.update({
        where: { userId },
        data: {
          recoveryCodeHashes: row.recoveryCodeHashes.filter((hash) => hash !== sha256(code)),
        },
      });
    } else {
      this.assertTotp(row.secretEncrypted, code);
    }
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { mfaSatisfied: true },
    });
    await writeAudit(this.prisma, {
      actorType: "staff",
      actorUserId: userId,
      action: "auth.mfa_verified",
    });
  }

  async logout(tokenHash: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit(this.prisma, {
      actorType: "staff",
      actorUserId: userId,
      action: "auth.logout_all",
    });
  }

  private assertTotp(secretEncrypted: string, code: string): void {
    const secret = decryptString(secretEncrypted, this.env.FIELD_ENCRYPTION_KEY);
    const totp = new TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });
    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      throw new AppError(401, ERROR_CODES.MFA_INVALID, "MFA inválido.");
    }
  }
}
