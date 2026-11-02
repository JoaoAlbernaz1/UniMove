import { io } from "socket.io-client";
import { API_URL } from "../config";

export type ChatSocketAcknowledgement<T = never> =
  { ok: true; data?: T } | { ok: false; error: string };

export function createChatSocket(
  getFreshAccessToken: () => Promise<string>,
  onAuthenticationError: (error: unknown) => void,
) {
  const socketUrl = new URL(API_URL);
  return io(`${socketUrl.origin}/chat`, {
    autoConnect: false,
    transports: ["websocket"],
    auth: (callback) => {
      void getFreshAccessToken()
        .then((token) => callback({ token }))
        .catch((error: unknown) => {
          onAuthenticationError(error);
          callback({ token: "" });
        });
    },
  });
}
