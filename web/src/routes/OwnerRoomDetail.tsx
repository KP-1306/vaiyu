import { useParams } from "react-router-dom";
import { useOwnerT } from "../i18n/useOwnerT";

export default function OwnerRoomDetail() {
  const { roomId } = useParams();
  const t = useOwnerT("owner-common");
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">{t("terms.room", "Room")} {roomId}</h1>
    </main>
  );
}
