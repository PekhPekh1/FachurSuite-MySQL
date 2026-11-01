-- CreateTable
CREATE TABLE `customers` (
    `id` VARCHAR(36) NOT NULL,
    `first_name` VARCHAR(60) NOT NULL,
    `last_name` VARCHAR(60) NOT NULL,
    `full_name` VARCHAR(120) NOT NULL,
    `national_code` VARCHAR(10) NOT NULL,
    `mobile` VARCHAR(11) NOT NULL,
    `phone` VARCHAR(11) NULL,
    `address` VARCHAR(191) NULL,
    `occupation` VARCHAR(120) NULL,
    `notes` VARCHAR(191) NULL,
    `tags` JSON NOT NULL,
    `is_blacklisted` BOOLEAN NOT NULL DEFAULT false,
    `blacklist_reason` VARCHAR(191) NULL,
    `blacklisted_at` DATETIME(3) NULL,
    `blacklisted_by` VARCHAR(36) NULL,
    `credit_limit` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `credit_score` INTEGER NOT NULL DEFAULT 500,
    `credit_score_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `deactivated_at` DATETIME(3) NULL,
    `deactivated_by` VARCHAR(36) NULL,
    `deactivation_reason` VARCHAR(191) NULL,
    `created_by` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `customers_national_code_key`(`national_code`),
    INDEX `customers_mobile_idx`(`mobile`),
    INDEX `customers_name_idx`(`last_name`, `first_name`),
    INDEX `customers_active_idx`(`is_active`),
    INDEX `customers_blacklist_idx`(`is_blacklisted`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_credit_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `customer_id` VARCHAR(36) NOT NULL,
    `old_score` INTEGER NOT NULL,
    `new_score` INTEGER NOT NULL,
    `reason` VARCHAR(120) NOT NULL,
    `details` JSON NULL,
    `computed_by` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `credit_history_customer_idx`(`customer_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(36) NOT NULL,
    `username` VARCHAR(60) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `full_name` VARCHAR(120) NOT NULL,
    `role` ENUM('ADMIN', 'OPERATOR', 'CUSTOMER') NOT NULL,
    `customer_id` VARCHAR(36) NULL,
    `can_review_payments` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `session_version` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `token_hash` VARCHAR(128) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,

    INDEX `refresh_tokens_user_idx`(`user_id`),
    PRIMARY KEY (`token_hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guarantors` (
    `id` VARCHAR(36) NOT NULL,
    `customer_id` VARCHAR(36) NOT NULL,
    `full_name` VARCHAR(120) NOT NULL,
    `national_code` VARCHAR(10) NULL,
    `mobile` VARCHAR(11) NULL,
    `relation` VARCHAR(60) NULL,
    `address` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `guarantors_customer_idx`(`customer_id`),
    INDEX `guarantors_active_idx`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `documents` (
    `id` VARCHAR(36) NOT NULL,
    `owner_type` VARCHAR(12) NOT NULL,
    `owner_id` VARCHAR(36) NOT NULL,
    `category` VARCHAR(40) NOT NULL DEFAULT 'OTHER',
    `file_name` VARCHAR(200) NOT NULL,
    `stored_name` VARCHAR(260) NOT NULL,
    `mime_type` VARCHAR(80) NOT NULL,
    `checksum_sha256` VARCHAR(64) NOT NULL,
    `size` INTEGER NOT NULL,
    `uploaded_by` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `documents_stored_name_key`(`stored_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contracts` (
    `id` VARCHAR(36) NOT NULL,
    `contract_no` VARCHAR(24) NOT NULL,
    `type` ENUM('CASH', 'INSTALLMENT') NOT NULL,
    `customer_id` VARCHAR(36) NOT NULL,
    `guarantor_id` VARCHAR(36) NULL,
    `item_description` VARCHAR(191) NOT NULL,
    `item_serial_number` VARCHAR(80) NULL,
    `notes` VARCHAR(191) NULL,
    `cash_price` DECIMAL(18, 2) NOT NULL,
    `total_price` DECIMAL(18, 2) NOT NULL,
    `down_payment` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `installment_count` INTEGER NOT NULL DEFAULT 0,
    `installment_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `discrepancy` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `discrepancy_override` BOOLEAN NOT NULL DEFAULT false,
    `discrepancy_override_by` VARCHAR(36) NULL,
    `discrepancy_override_reason` VARCHAR(191) NULL,
    `first_due_date` DATE NULL,
    `payment_day` INTEGER NULL,
    `idempotency_key` VARCHAR(64) NULL,
    `status` ENUM('ACTIVE', 'SETTLED', 'CANCELED') NOT NULL DEFAULT 'ACTIVE',
    `cancel_reason` VARCHAR(191) NULL,
    `canceled_at` DATETIME(3) NULL,
    `canceled_by` VARCHAR(36) NULL,
    `created_by` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `contracts_contract_no_key`(`contract_no`),
    UNIQUE INDEX `contracts_idempotency_key_key`(`idempotency_key`),
    INDEX `contracts_customer_idx`(`customer_id`),
    INDEX `contracts_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `installments` (
    `id` VARCHAR(36) NOT NULL,
    `contract_id` VARCHAR(36) NOT NULL,
    `seq` INTEGER NOT NULL,
    `due_date` DATE NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `status` ENUM('PENDING', 'RESERVED', 'PAID', 'FORGIVEN') NOT NULL DEFAULT 'PENDING',
    `paid_at` DATETIME(3) NULL,
    `payment_id` VARCHAR(36) NULL,
    `penalty_forgiven` BOOLEAN NOT NULL DEFAULT false,
    `forgiven_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `forgiven_by` VARCHAR(36) NULL,
    `forgiven_reason` VARCHAR(191) NULL,
    `forgiven_at` DATETIME(3) NULL,
    `original_due_date` DATE NULL,
    `due_date_changed_by` VARCHAR(36) NULL,
    `due_date_changed_at` DATETIME(3) NULL,
    `due_date_change_reason` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `installments_due_idx`(`due_date`),
    INDEX `installments_status_idx`(`status`),
    UNIQUE INDEX `installments_contract_seq_uq`(`contract_id`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(36) NOT NULL,
    `idempotency_key` VARCHAR(64) NOT NULL,
    `contract_id` VARCHAR(36) NOT NULL,
    `customer_id` VARCHAR(36) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `penalty_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `method` ENUM('CASH', 'CARD_READER', 'CARD_TO_CARD') NOT NULL,
    `status` ENUM('PENDING_VERIFICATION', 'CONFIRMED', 'REJECTED') NOT NULL,
    `source_card_number` VARCHAR(19) NULL,
    `destination_card_mask` VARCHAR(19) NULL,
    `reference_no` VARCHAR(80) NULL,
    `note` VARCHAR(191) NULL,
    `paid_at` DATETIME(3) NULL,
    `is_settlement` BOOLEAN NOT NULL DEFAULT false,
    `settlement_meta` JSON NULL,
    `resubmission_of` VARCHAR(36) NULL,
    `is_resubmittable` BOOLEAN NOT NULL DEFAULT false,
    `submitted_by` VARCHAR(36) NULL,
    `reviewed_by` VARCHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `review_note` VARCHAR(191) NULL,
    `receipt_document_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payments_idempotency_key_key`(`idempotency_key`),
    INDEX `payments_contract_idx`(`contract_id`),
    INDEX `payments_customer_idx`(`customer_id`),
    INDEX `payments_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_installments` (
    `payment_id` VARCHAR(36) NOT NULL,
    `installment_id` VARCHAR(36) NOT NULL,

    UNIQUE INDEX `payment_installments_inst_uq`(`installment_id`),
    PRIMARY KEY (`payment_id`, `installment_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `key` VARCHAR(40) NOT NULL,
    `value` JSON NOT NULL,
    `updated_by` VARCHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(36) NULL,
    `user_name` VARCHAR(120) NULL,
    `user_role` VARCHAR(20) NULL,
    `action` VARCHAR(60) NOT NULL,
    `entity` VARCHAR(40) NOT NULL,
    `entity_id` VARCHAR(64) NULL,
    `meta` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_created_idx`(`created_at`),
    INDEX `audit_entity_idx`(`entity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sms_logs` (
    `id` VARCHAR(36) NOT NULL,
    `customer_id` VARCHAR(36) NULL,
    `phone` VARCHAR(20) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `detail` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sms_created_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sms_templates` (
    `key` VARCHAR(60) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `category` VARCHAR(40) NOT NULL DEFAULT 'CUSTOM',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holidays` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `date` DATE NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `holidays_date_key`(`date`),
    INDEX `holidays_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `counters` (
    `key` VARCHAR(40) NOT NULL,
    `value` BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sms_jobs` (
    `id` VARCHAR(36) NOT NULL,
    `dedupe_key` VARCHAR(160) NOT NULL,
    `template_key` VARCHAR(60) NOT NULL,
    `customer_id` VARCHAR(36) NULL,
    `phone` VARCHAR(20) NOT NULL,
    `vars` JSON NULL,
    `scheduled_for` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_attempt_at` DATETIME(3) NULL,
    `last_error` VARCHAR(191) NULL,
    `sms_log_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sms_jobs_dedupe_key_key`(`dedupe_key`),
    INDEX `sms_jobs_pending_idx`(`status`, `scheduled_for`),
    INDEX `sms_jobs_customer_idx`(`customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `backup_history` (
    `id` VARCHAR(36) NOT NULL,
    `file_name` VARCHAR(120) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `table_count` INTEGER NOT NULL,
    `table_counts` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    `detail` VARCHAR(191) NULL,
    `taken_by` VARCHAR(36) NULL,
    `taken_by_name` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `backup_history_created_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `customer_credit_history` ADD CONSTRAINT `customer_credit_history_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guarantors` ADD CONSTRAINT `guarantors_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_guarantor_id_fkey` FOREIGN KEY (`guarantor_id`) REFERENCES `guarantors`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `installments` ADD CONSTRAINT `installments_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_submitted_by_fkey` FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_installments` ADD CONSTRAINT `payment_installments_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_installments` ADD CONSTRAINT `payment_installments_installment_id_fkey` FOREIGN KEY (`installment_id`) REFERENCES `installments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

