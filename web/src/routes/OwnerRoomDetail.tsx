import { useParams } from "react-router-dom";

export default function OwnerRoomDetail() {
  const { roomId } = useParams();
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Room {roomId}</h1>
      <p className="text-gray-600 mt-1">Minimal detail shell OK.</p>
    </main>
  );
}
