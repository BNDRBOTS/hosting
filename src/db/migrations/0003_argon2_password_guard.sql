ALTER TABLE "users" ADD CONSTRAINT "users_password_hash_argon2id_check" CHECK ("users"."password_hash" like '$argon2id$%');--> statement-breakpoint
COMMENT ON CONSTRAINT users_password_hash_argon2id_check ON users IS 'I10: password credentials are persisted only as Argon2id hashes.';
