export type ChatMessage = {
  id: string;
  content: string;
  senderId: string;
  sender: { id: string; fullName: string };
  createdAt: string;
};

export type Conversation = {
  id: string;
  rideId: string;
  passengerId: string;
  canSend: boolean;
  passenger: { id: string; fullName: string };
  ride: {
    id: string;
    departureAt: string;
    driver: { id: string; fullName: string };
    originLocation: { name: string };
    destinationLocation: { name: string };
  };
  messages: Pick<ChatMessage, "id" | "content" | "senderId" | "createdAt">[];
  updatedAt: string;
};

export type AvailableChatParticipant = {
  rideId: string;
  departureAt: string;
  originLocation: { name: string };
  destinationLocation: { name: string };
  participant: { id: string; fullName: string };
  role: "DRIVER" | "PASSENGER";
};
