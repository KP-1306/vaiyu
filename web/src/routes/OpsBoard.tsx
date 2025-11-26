// web/src/routes/OpsBoard.tsx
// Thin wrapper around the Desk ops board so /ops can reuse the same UI.

import Desk from "./Desk";

export default function OpsBoard() {
  // Reuse the existing Desk experience – no new logic here.
  return <Desk />;
}
