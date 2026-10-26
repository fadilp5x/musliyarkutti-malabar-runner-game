import { getStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';
import { handleGameRequest } from '../../server/gameRoomService.js';

export default async function game(request: Request, _context: Context): Promise<Response> {
  const store = getStore({ name: 'malabar-runner-rooms', consistency: 'strong' });
  return handleGameRequest(request, { store });
}
