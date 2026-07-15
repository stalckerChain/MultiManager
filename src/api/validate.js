const { z } = require('zod');

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Ошибка валидации',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.body = result.data;
    next();
  };
}

// --- Profiles ---

const profileCreateSchema = z.object({
  name: z.string().min(1, 'name обязателен').max(100),
  platform: z.enum(['windows', 'macos', 'linux']),
  timezone: z.string().min(1, 'timezone обязателен'),
  proxy_id: z.number().int().positive().nullable().optional(),
  extensions: z.any().optional(),
  tags: z.any().optional(),
  notes: z.string().max(5000).optional(),
  email: z.string().email().nullable().optional(),
  email_password: z.string().max(500).nullable().optional(),
  twitter_username: z.string().max(100).nullable().optional(),
  twitter_password: z.string().max(500).nullable().optional(),
  twitter_auth_token: z.string().max(500).nullable().optional(),
  twitter_email: z.string().email().nullable().optional(),
  discord_username: z.string().max(100).nullable().optional(),
  discord_password: z.string().max(500).nullable().optional(),
  discord_token: z.string().max(500).nullable().optional(),
  discord_email: z.string().email().nullable().optional(),
  wallet_evm_address: z.string().max(100).nullable().optional(),
  wallet_sol_address: z.string().max(100).nullable().optional(),
  wallet_password: z.string().max(500).nullable().optional(),
});

const profileUpdateSchema = z.object({
  name: z.string().min(1, 'name обязателен').max(100).optional(),
  platform: z.enum(['windows', 'macos', 'linux']).optional(),
  timezone: z.string().max(100).nullable().optional(),
  proxy_id: z.number().int().positive().nullable().optional(),
  extensions: z.any().optional(),
  tags: z.any().optional(),
  notes: z.string().max(5000).nullable().optional(),
  email: z.any().optional(),
  email_password: z.any().optional(),
  twitter_username: z.any().optional(),
  twitter_password: z.any().optional(),
  twitter_auth_token: z.any().optional(),
  twitter_email: z.any().optional(),
  discord_username: z.any().optional(),
  discord_password: z.any().optional(),
  discord_token: z.any().optional(),
  discord_email: z.any().optional(),
  wallet_evm_address: z.any().optional(),
  wallet_sol_address: z.any().optional(),
  wallet_password: z.any().optional(),
}).passthrough();

const profileBatchSchema = z.object({
  accounts: z.array(z.object({
    name: z.string().min(1, 'name обязателен').max(100),
    platform: z.enum(['windows', 'macos', 'linux']),
    proxy_id: z.number().int().positive().nullable().optional(),
    extensions: z.any().optional(),
    tags: z.any().optional(),
    notes: z.string().max(5000).optional(),
    timezone: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    email_password: z.string().max(500).nullable().optional(),
    twitter_username: z.string().max(100).nullable().optional(),
    twitter_password: z.string().max(500).nullable().optional(),
    twitter_auth_token: z.string().max(500).nullable().optional(),
    twitter_email: z.string().email().nullable().optional(),
    discord_username: z.string().max(100).nullable().optional(),
    discord_password: z.string().max(500).nullable().optional(),
    discord_token: z.string().max(500).nullable().optional(),
    discord_email: z.string().email().nullable().optional(),
    wallet_evm_address: z.string().max(100).nullable().optional(),
    wallet_sol_address: z.string().max(100).nullable().optional(),
    wallet_password: z.string().max(500).nullable().optional(),
  })).min(1, 'accounts должен содержать хотя бы 1 элемент').max(500, 'максимум 500 профилей за раз'),
});

// --- Proxies ---

const proxyCreateSchema = z.object({
  type: z.enum(['http', 'https', 'socks5']),
  host: z.string().min(1, 'host обязателен').max(255),
  port: z.number().int().min(1, 'port обязателен').max(65535),
  username: z.string().max(200).nullable().optional(),
  password: z.string().max(200).nullable().optional(),
  proxy_rotation_url: z.string().url().max(2000).nullable().optional(),
});

const proxyUpdateSchema = proxyCreateSchema.partial();

const proxyImportSchema = z.object({
  text: z.string().min(1, 'text обязателен').max(100000, 'максимум 100KB текста'),
});

// --- Browser ---

const browserTypeSchema = z.object({
  text: z.string().min(1, 'text обязателен').max(10000, 'максимум 10000 символов'),
});

// --- Projects ---

const projectUpdateSchema = z.object({
  display_name: z.string().max(200).optional(),
  is_active: z.number().int().min(0).max(1).optional(),
  default_config: z.string().max(50000).optional(),
  module_path: z.string().max(500).optional(),
  class_name: z.string().max(200).optional(),
});

// --- Runs ---

const runCreateSchema = z.object({
  name: z.string().max(200).optional(),
  parallel_limit: z.number().int().min(1).max(50).optional(),
});

// --- Cookies ---

const cookieImportSchema = z.object({
  format: z.enum(['json', 'netscape']),
  content: z.string().min(1, 'content обязателен').max(500000, 'максимум 500KB'),
});

module.exports = {
  validate,
  profileCreateSchema,
  profileUpdateSchema,
  profileBatchSchema,
  proxyCreateSchema,
  proxyUpdateSchema,
  proxyImportSchema,
  browserTypeSchema,
  projectUpdateSchema,
  runCreateSchema,
  cookieImportSchema,
};
