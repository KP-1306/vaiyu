// web/src/components/rewards/StayWalletPanel.tsx
import RewardsWallet from "./RewardsWallet";

export type StayWalletPanelProps = {
  /** Current stay's hotel id (used to scope rewards). */
  hotelId?: string;
  /** Optional hotel name, for friendlier headings. */
  hotelName?: string | null;
  /** Optional extra classes for outer container. */
  className?: string;
};

/**
 * Thin wrapper around RewardsWallet that renders a compact
 * "stay wallet" section for the unified /stay/:code page.
 *
 * It keeps all rewards logic inside RewardsWallet and just
 * configures it to the "stay" context (single property, no
 * global navigation buttons).
 */
export default function StayWalletPanel({
  hotelId,
  hotelName,
  className,
}: StayWalletPanelProps) {
  const label = hotelName
    ? `Your stay wallet at ${hotelName}`
    : "Your stay wallet";

  return (
    <section
      id="stay-wallet"
      className={
        "rounded-2xl border bg-white/90 shadow-sm p-4 space-y-3 " +
        (className || "")
      }
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Rewards &amp; offers</h2>
          <p className="text-xs text-gray-600 mt-1">
            Track and redeem credits for this property while you&apos;re in-house.
          </p>
        </div>
      </header>

      <div className="border-t pt-3">
        <RewardsWallet
          context="stay"
          hotelId={hotelId}
          stayLabel={label}
          showBackLink={false}
        />
      </div>
    </section>
  );
}
