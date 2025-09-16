import { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ---- Types ----
type LowRatingPayload = {
  name: string;
  phone: string; // digits only
  stars: number;
  review: string;
  createdAt: string;
  userAgent?: string;
  referer?: string;
  type?: string; // 'low_rating' | 'high_rating'
};

type Props = {
  twoGisUrl?: string;
  onSubmitLowRating?: (payload: LowRatingPayload) => Promise<void> | void;
  brandName?: string;
};

// === CONFIG: paste your Google Apps Script Web App URL below or via env ===
const SHEET_WEBAPP_URL = (import.meta as any).env?.VITE_SHEET_WEBAPP_URL || ""; // e.g. https://script.google.com/macros/s/XXXX/exec

// ---- Utils ----
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const digitsOnly = (v: string) => v.replace(/\D/g, "");

// Simple +7 mask: +7 777 123 45 67
function formatKzWhatsApp(input: string) {
  let d = digitsOnly(input);
  if (!d) return "+7 ";
  if (d.startsWith("8")) d = "7" + d.slice(1); // normalize local 8 → 7
  if (!d.startsWith("7")) d = "7" + d; // ensure +7
  d = d.slice(0, 11);
  let out = "+7";
  if (d.length > 1) out += " " + d.slice(1, 4);
  if (d.length > 4) out += " " + d.slice(4, 7);
  if (d.length > 7) out += " " + d.slice(7, 9);
  if (d.length > 9) out += " " + d.slice(9, 11);
  return out;
}

// Prefer sendBeacon for reliability before redirects
function logToGoogleSheet(payload: LowRatingPayload) {
  if (!SHEET_WEBAPP_URL) {
    console.warn("Sheet URL is empty");
    return;
  }
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: "text/plain" });
    if (navigator.sendBeacon && navigator.sendBeacon(SHEET_WEBAPP_URL, blob)) return;
  } catch {}
  fetch(SHEET_WEBAPP_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  }).catch((err) => console.warn("Sheet fetch failed:", err));
}

export default function FeedbackLanding({
  twoGisUrl = "https://2gis.kz/astana/firm/70000001091859268/tab/reviews",
  onSubmitLowRating,
  brandName = "Огонек 🔥",
}: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+7 ");
  const [stars, setStars] = useState(0);
  const [hoverStars, setHoverStars] = useState(0);
  const [review, setReview] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [botTrap, setBotTrap] = useState(""); // honeypot

  // Styled success modal (for 1–3⭐ flow)
  const [successOpen, setSuccessOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState(
    "Спасибо! Мы получили ваш отзыв и уже работаем над улучшениями ❤️"
  );

  // NEW: toast for high rating (4–5⭐)
  const [highToastOpen, setHighToastOpen] = useState(false);

  const ratingRef = useRef<HTMLDivElement | null>(null);

  // Persist name/phone locally
  useEffect(() => {
    const cached = localStorage.getItem("fb_name_phone");
    if (cached) {
      try {
        const { n, p } = JSON.parse(cached);
        if (typeof n === "string") setName(n);
        if (typeof p === "string") setPhone(p);
      } catch {}
    }
  }, []);
  useEffect(() => {
    localStorage.setItem("fb_name_phone", JSON.stringify({ n: name, p: phone }));
  }, [name, phone]);

  // Auto-close success modal (optional)
  useEffect(() => {
    if (!successOpen) return;
    const id = setTimeout(() => setSuccessOpen(false), 2200);
    return () => clearTimeout(id);
  }, [successOpen]);

  const phoneDigits = useMemo(() => digitsOnly(phone), [phone]);
  const isValidPhone = phoneDigits.length === 11 && phoneDigits.startsWith("7");
  const isValid = name.trim().length > 1 && isValidPhone && stars > 0;

  const handleSelectStars = (value: number) => setStars(value);

  const handlePrimarySubmit = async () => {
    setTouched(true);
    if (!isValid) return;
    if (botTrap) return; // ignore bots

    if (stars <= 3) {
      setShowModal(true);
    } else {
      // Log positive rating before redirect
      logToGoogleSheet({
        type: "high_rating",
        name: name.trim(),
        phone: phoneDigits,
        stars,
        review: "",
        createdAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        referer: location.href,
      });
      // Show helpful toast on the original tab
      setHighToastOpen(true);
      window.open(twoGisUrl, "_blank", "noopener,noreferrer");
    }
  };

  const MIN_REVIEW = 20;
  const MAX_REVIEW = 500;

  const handleSendLowRating = async () => {
    setSubmitting(true);
    const payload: LowRatingPayload = {
      type: "low_rating",
      name: name.trim(),
      phone: phoneDigits,
      stars,
      review: review.trim(),
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      referer: location.href,
    };

    try {
      // Log to Google Sheet (fire-and-forget)
      logToGoogleSheet(payload);

      if (onSubmitLowRating) {
        await onSubmitLowRating(payload);
      } else {
        // Replace with real POST/Telegram webhook
        console.log("LOW-RATING FEEDBACK:", payload);
        await new Promise((r) => setTimeout(r, 600));
      }
      setShowModal(false);
      setReview("");
      setSuccessMsg("Спасибо! Мы получили ваш отзыв и уже работаем над улучшениями ❤️");
      setSuccessOpen(true);
    } catch (e) {
      console.error(e);
      setSuccessMsg("Упс! Не получилось отправить. Попробуйте ещё раз.");
      setSuccessOpen(true);
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard support for rating
  const onRatingKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") setStars((s) => clamp(s - 1, 1, 5));
    if (e.key === "ArrowRight") setStars((s) => clamp(s + 1, 1, 5));
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-amber-50 via-white to-white">
      {/* HERO */}
      <section className="px-4 py-10 sm:py-14">
        <div className="mx-auto max-w-3xl text-center">
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-3xl sm:text-4xl font-extrabold tracking-tight"
          >
            🙌 Поделись честным впечатлением — <span className="bg-yellow-200 rounded-xl px-2">и выиграй приз</span> 🎁
          </motion.h1>
        </div>
      </section>

      {/* CARD */}
      <section className="px-4 pb-16">
        <div className="mx-auto max-w-xl">
          <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8">
            <h2 className="text-xl font-semibold mb-5">📝 Оставьте отзыв</h2>

            {/* Honeypot (anti-spam) */}
            <input
              type="text"
              value={botTrap}
              onChange={(e) => setBotTrap(e.target.value)}
              className="hidden"
              tabIndex={-1}
              aria-hidden
              autoComplete="off"
            />

            {/* Name */}
            <label className="block text-sm font-medium mb-1">Имя</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Как к вам обращаться?"
              className={`w-full border rounded-xl px-3 py-2 mb-1 focus:outline-none focus:ring-2 focus:ring-amber-300 ${
                touched && name.trim().length <= 1 ? "border-red-400" : "border-gray-300"
              }`}
            />
            {touched && name.trim().length <= 1 && (
              <p className="text-xs text-red-600 mb-3">Имя должно быть длиннее 1 символа.</p>
            )}

            {/* WhatsApp */}
            <label className="block text-sm font-medium mb-1">Номер WhatsApp</label>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(formatKzWhatsApp(e.target.value))}
              onBlur={() => setTouched(true)}
              placeholder="+7 777 123 45 67"
              className={`w-full border rounded-xl px-3 py-2 mb-1 focus:outline-none focus:ring-2 focus:ring-amber-300 ${
                touched && !isValidPhone ? "border-red-400" : "border-gray-300"
              }`}
            />
            {touched && !isValidPhone && (
              <p className="text-xs text-red-600 mb-3">Введите корректный номер в формате +7 XXX XXX XX XX.</p>
            )}

            {/* Stars */}
            <label className="block text-sm font-medium mb-2">Сколько звёзд поставите?</label>
            <div
              ref={ratingRef}
              role="slider"
              aria-label="Рейтинг"
              aria-valuemin={1}
              aria-valuemax={5}
              aria-valuenow={stars || 0}
              tabIndex={0}
              onKeyDown={onRatingKeyDown}
              className="flex items-center gap-1 mb-1 select-none"
            >
              {[1, 2, 3, 4, 5].map((s) => {
                const active = (hoverStars || stars) >= s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleSelectStars(s)}
                    onMouseEnter={() => setHoverStars(s)}
                    onMouseLeave={() => setHoverStars(0)}
                    className={`text-3xl transition-transform active:scale-95 ${
                      active ? "text-yellow-400" : "text-gray-300"
                    }`}
                    aria-label={`${s} звезда`}
                  >
                    ★
                  </button>
                );
              })}
            </div>

            {/* Errors */}
            <AnimatePresence>
              {touched && !isValid && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="text-sm text-red-600 mb-3"
                >
                  Проверьте, пожалуйста: имя (≥2 символа), номер WhatsApp и оценку.
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="button"
              onClick={handlePrimarySubmit}
              disabled={!isValid}
              className="w-full mt-1 rounded-2xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 transition-colors"
            >
              Отправить
            </button>

            <p className="mt-3 text-xs text-gray-400">Нажимая «Отправить», вы соглашаетесь с обработкой персональных данных.</p>
          </div>
        </div>
      </section>

      {/* MODAL for 1–3 stars */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="lowRateTitle"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
              className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6"
            >
              <h3 id="lowRateTitle" className="text-lg font-semibold mb-2">🙏 Спасибо за честность!</h3>
              <p className="text-sm text-gray-600 mb-4">
                Расскажите, что именно можно улучшить — это поможет нам стать лучше.
              </p>
              <div className="flex items-center justify-between mb-1 text-xs text-gray-500">
                <span>Минимум {MIN_REVIEW} символов</span>
                <span>
                  {review.length}/{MAX_REVIEW}
                </span>
              </div>
              <textarea
                value={review}
                onChange={(e) => setReview(e.target.value.slice(0, MAX_REVIEW))}
                placeholder="Опишите ваш опыт: что понравилось/не понравилось, что улучшить"
                rows={5}
                className="w-full border rounded-2xl px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-amber-300 border-gray-300"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-2xl border border-gray-300 py-2 font-medium hover:bg-gray-50"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleSendLowRating}
                  disabled={submitting || review.trim().length < MIN_REVIEW}
                  className="flex-1 rounded-2xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white font-semibold py-2 flex items-center justify-center gap-2"
                >
                  {submitting && (
                    <span className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  )}
                  {submitting ? "Отправляем..." : "Отправить отзыв"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SUCCESS MODAL (styled) for low rating */}
      <AnimatePresence>
        {successOpen && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
              className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 text-center"
            >
              <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
                  <path d="M20 7L10 17l-4-4" stroke="currentColor" strokeWidth="2.5" className="text-emerald-600" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm text-gray-700 mb-4">{successMsg}</p>
              <button
                onClick={() => setSuccessOpen(false)}
                className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-2"
              >
                Закрыть
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HIGH-RATING TOAST (4–5⭐) */}
      <AnimatePresence>
        {highToastOpen && (
          <motion.div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[55] px-4"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
          >
            <div className="w-[92vw] max-w-xl rounded-2xl bg-emerald-600 text-white shadow-lg px-4 py-3 flex items-start gap-3">
              <span className="text-2xl">✨</span>
              <div className="text-sm leading-snug pr-2">
                <b>Отлично!</b> Добавили вас в базу. <br />
                Покажите свой отзыв официанту, чтобы подтвердить участие в конкурсе. 🎉📱
              </div>
              <button
                aria-label="Закрыть уведомление"
                onClick={() => setHighToastOpen(false)}
                className="ml-auto -mr-1 h-6 w-6 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center"
              >
                ×
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FOOTER */}
      <footer className="px-4 pb-10 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} {brandName} · Сделано с заботой 💛
      </footer>
    </div>
  );
}
