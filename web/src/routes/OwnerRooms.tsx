import { useOwnerCommonT } from "../i18n/useOwnerT";

export default function OwnerRooms() {
  const tc = useOwnerCommonT();
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">{tc("nav.rooms", "Rooms")}</h1>
    </main>
  );
}
