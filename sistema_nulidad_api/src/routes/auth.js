import { Router } from 'express';
import { authenticate } from '../security/auth.js';
import { requireChannel } from '../security/channel.js';
import { authenticatePassword, publicUser } from '../services/auth-service.js';
import { updateOwnProfile } from '../services/profile-service.js';

const router = Router();

router.post('/login', async (request, response, next) => {
  try {
    const { email, password, clientChannel } = request.body ?? {};
    const { accessToken, user } = await authenticatePassword({
      email,
      password,
      clientChannel,
      allowedChannels: ['web', 'technical']
    });
    response.status(200).json({
      accessToken,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '30m',
      user: publicUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', authenticate, (request, response) => {
  const { user, channel } = request.auth;
  response.json({
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    channel,
    roles: user.roles,
    permissions: user.permissions
  });
});

router.patch('/me', authenticate, requireChannel(['web', 'technical']), async (request, response, next) => {
  try {
    const { user, changed } = await updateOwnProfile({
      userId: request.auth.user.id,
      payload: request.body,
      clientChannel: request.auth.channel,
      ipAddress: request.ip
    });
    response.json({ user: publicUser(user), changed });
  } catch (error) {
    next(error);
  }
});

export default router;
