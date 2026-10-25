export type ChatMessage = {
  id: string;
  content: string;
  senderId: string;
  sender: { id: string; fullName: string };
  createdAt: string;
};

export type ChatMessagePreview = Pick<ChatMessage, 'id' | 'content' | 'senderId' | 'createdAt'>;

export type ChatConversation = {
  id: string;
  rideId: string;
  passengerId: string;
  ride: {
    id: string;
    departureAt: string;
    driver: { id: string; fullName: string };
    originLocation: { name: string };
    destinationLocation: { name: string };
  };
  passenger: { id: string; fullName: string };
  messages: ChatMessagePreview[];
  updatedAt: string;
};

export type AvailableChatParticipant = {
  rideId: string;
  departureAt: string;
  originLocation: { name: string };
  destinationLocation: { name: string };
  participant: { id: string; fullName: string };
  role: 'DRIVER' | 'PASSENGER';
};
