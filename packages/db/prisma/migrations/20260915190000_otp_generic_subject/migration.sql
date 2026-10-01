ALTER TABLE "otp_requests" RENAME COLUMN "dni_hmac" TO "subject_hmac";
ALTER TABLE "otp_requests" RENAME COLUMN "phone_hmac" TO "destination_hmac";
ALTER INDEX "otp_requests_dni_hmac_purpose_created_at_idx" RENAME TO "otp_requests_subject_hmac_purpose_created_at_idx";
ALTER INDEX "otp_requests_phone_hmac_created_at_idx" RENAME TO "otp_requests_destination_hmac_created_at_idx";
