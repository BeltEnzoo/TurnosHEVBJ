ALTER TABLE "display_offices" DROP CONSTRAINT "display_offices_office_id_fkey";

ALTER TABLE "display_offices" ADD CONSTRAINT "display_offices_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
