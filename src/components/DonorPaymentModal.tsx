import { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  CreditCard,
  IndianRupee,
  Lock,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import type { BloodType, PaymentReceipt } from '../types';

export interface UnlockTargetDonor {
  donorId: string;
  anonymousHandle: string;
  bloodType: BloodType;
  neighborhood: string;
}

interface DonorPaymentModalProps {
  target: UnlockTargetDonor | null;
  onClose: () => void;
  onConfirmPayment: (
    donorId: string,
    paymentMethod: string,
    paymentDetails?: string
  ) => Promise<PaymentReceipt | void>;
  onOpenUnlockedChat?: () => void;
}

const NETBANKING_BANKS = [
  'State Bank of India',
  'HDFC Bank',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Mahindra Bank',
];

export function DonorPaymentModal({
  target,
  onClose,
  onConfirmPayment,
  onOpenUnlockedChat,
}: DonorPaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'Card' | 'NetBanking'>('UPI');
  const [upiId, setUpiId] = useState('raktsetu.member@upi');
  const [cardNumber, setCardNumber] = useState('4242 4242 4242 4242');
  const [cardExpiry, setCardExpiry] = useState('12/28');
  const [cardCvv, setCardCvv] = useState('424');
  const [bankName, setBankName] = useState(NETBANKING_BANKS[0]);
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [completedReceipt, setCompletedReceipt] = useState<PaymentReceipt | null>(null);

  useEffect(() => {
    setPaymentError(null);
    setPaying(false);
    setCompletedReceipt(null);
  }, [target?.donorId]);

  if (!target) return null;

  const handleConfirm = async () => {
    setPaymentError(null);

    let details = '';
    if (paymentMethod === 'UPI') {
      const cleanedUpi = upiId.trim();
      if (!cleanedUpi || !/^[^\s@]+@[^\s@]+$/.test(cleanedUpi)) {
        setPaymentError('Enter a valid UPI ID (for example, name@okaxis).');
        return;
      }
      details = cleanedUpi;
    } else if (paymentMethod === 'Card') {
      const digits = cardNumber.replace(/\D/g, '');
      if (digits.length < 12 || digits.length > 19) {
        setPaymentError('Enter a valid 12–19 digit debit or credit card number.');
        return;
      }
      if (!/^\d{2}\/\d{2}$/.test(cardExpiry.trim())) {
        setPaymentError('Enter card expiry in MM/YY format.');
        return;
      }
      if (!/^\d{3,4}$/.test(cardCvv.trim())) {
        setPaymentError('Enter a valid 3 or 4 digit CVV.');
        return;
      }
      details = `Card ending in ${digits.slice(-4)}`;
    } else {
      details = bankName;
    }

    setPaying(true);
    try {
      const receipt = await onConfirmPayment(target.donorId, paymentMethod, details);
      if (receipt) {
        setCompletedReceipt(receipt);
      }
    } catch (err) {
      setPaymentError(
        err instanceof Error ? err.message : 'Payment could not be completed.'
      );
    } finally {
      setPaying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="donor-payment-title"
      data-testid="donor-payment-modal"
    >
      <div className="w-full max-w-md bg-[#111827] border border-slate-700 rounded-2xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>Donor Chat Access</span>
            </span>
            <h3
              id="donor-payment-title"
              className="font-display text-lg font-bold text-white mt-1"
            >
              {completedReceipt ? '₹50 Payment Confirmed' : 'Pay ₹50 to Open Chat'}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              One-time ₹50 coordination unlock fee to open real-time anonymous messaging with{' '}
              <span className="font-mono text-slate-200">
                {target.anonymousHandle}
              </span>{' '}
              ({target.bloodType}).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close payment modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-xl bg-[#090D16] border border-slate-800 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">Donor Zone</p>
            <p className="text-sm font-medium text-white mt-0.5">
              {target.neighborhood}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Unlock Fee</p>
            <p className="font-mono text-xl font-bold text-emerald-400">₹50</p>
          </div>
        </div>

        {completedReceipt ? (
          <div className="space-y-4">
            <div
              className="rounded-xl bg-emerald-950/35 border border-emerald-700/70 p-4 space-y-2 text-xs"
              data-testid="payment-success-receipt"
            >
              <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                <span>Chat Unlocked · Receipt Issued</span>
              </div>
              <p className="text-slate-200 font-mono">
                Txn ID: {completedReceipt.transactionId}
              </p>
              <p className="text-slate-300">
                Paid ₹{completedReceipt.amountInr} via {completedReceipt.paymentMethod}
                {completedReceipt.paymentDetails
                  ? ` (${completedReceipt.paymentDetails})`
                  : ''}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-700 bg-[#090D16] hover:bg-slate-800 text-xs font-medium text-slate-300 cursor-pointer"
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onOpenUnlockedChat) {
                    onOpenUnlockedChat();
                  } else {
                    onClose();
                  }
                }}
                data-testid="open-unlocked-chat-button"
                className="min-h-[42px] px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <span>Open Anonymous Chat</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <span className="block text-xs font-medium text-slate-300">
                Select Payment Method
              </span>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'UPI', label: 'UPI', Icon: Smartphone },
                    { id: 'Card', label: 'Card', Icon: CreditCard },
                    { id: 'NetBanking', label: 'NetBanking', Icon: Building2 },
                  ] as const
                ).map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(id);
                      setPaymentError(null);
                    }}
                    className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                      paymentMethod === id
                        ? 'bg-rose-600/20 border-rose-500 text-white'
                        : 'bg-[#090D16] border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 text-rose-400" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod === 'UPI' && (
              <div>
                <label
                  htmlFor="payment-upi-id"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  UPI ID
                </label>
                <input
                  id="payment-upi-id"
                  type="text"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="yourname@okaxis"
                  className="w-full min-h-[40px] px-3 rounded-xl bg-[#090D16] border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                />
              </div>
            )}

            {paymentMethod === 'Card' && (
              <div className="space-y-2.5">
                <div>
                  <label
                    htmlFor="payment-card-number"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Card Number
                  </label>
                  <input
                    id="payment-card-number"
                    type="text"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    placeholder="4242 4242 4242 4242"
                    className="w-full min-h-[40px] px-3 rounded-xl bg-[#090D16] border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor="payment-card-expiry"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Expiry (MM/YY)
                    </label>
                    <input
                      id="payment-card-expiry"
                      type="text"
                      value={cardExpiry}
                      onChange={(e) => setCardExpiry(e.target.value)}
                      placeholder="12/28"
                      className="w-full min-h-[40px] px-3 rounded-xl bg-[#090D16] border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="payment-card-cvv"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      CVV
                    </label>
                    <input
                      id="payment-card-cvv"
                      type="password"
                      maxLength={4}
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value)}
                      placeholder="424"
                      className="w-full min-h-[40px] px-3 rounded-xl bg-[#090D16] border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {paymentMethod === 'NetBanking' && (
              <div>
                <label
                  htmlFor="payment-bank-select"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Select Bank
                </label>
                <select
                  id="payment-bank-select"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-[#090D16] border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-rose-500"
                >
                  {NETBANKING_BANKS.map((bank) => (
                    <option key={bank} value={bank}>
                      {bank}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>
                Instant unlock persisted to your account with digital receipt.
              </span>
            </p>
          </>
        )}

        {paymentError && (
          <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-xs text-rose-200">
            {paymentError}
          </div>
        )}

        {!completedReceipt && (
          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={paying}
              className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-700 bg-[#090D16] hover:bg-slate-800 text-xs font-medium text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={paying}
              data-testid="confirm-payment-50-button"
              className="min-h-[42px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <IndianRupee className="w-3.5 h-3.5" />
              <span>{paying ? 'Processing ₹50...' : 'Pay ₹50 & Unlock Chat'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
