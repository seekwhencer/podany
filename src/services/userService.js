import { User } from '../models/User.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export class UserError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'UserError';
    this.status = status;
  }
}

export class UserService {
  constructor(deps = {}) {
    this.users = deps.users ?? new User();
  }

  async getOptions(userId) {
    const user = await this.users.findById(userId);
    if (!user) return null;
    return { color: user.color };
  }

  async updateOptions(userId, options = {}) {
    if (options.color !== undefined && options.color !== null) {
      const value = String(options.color).trim().toLowerCase();
      if (!COLOR_RE.test(value)) {
        throw new UserError('color must be a valid hex color like #aabbcc.', 400);
      }
      await this.users.updateColor(userId, value);
    }
    const user = await this.users.findById(userId);
    if (!user) return null;
    return { color: user.color };
  }
}

export default UserService;
