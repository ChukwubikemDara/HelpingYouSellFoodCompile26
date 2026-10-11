"use client";

/**
 * New listing: the merchant describes what they have (text and/or a photo);
 * the listing assistant returns one draft per product (2-10 s). No drafts ->
 * the manual form.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useMerchant } from "@/components/PortalShell";
import { InlineMessage, Spinner } from "@/components/States";
import { createDrafts, errorMessage } from "@/lib/client/api";
import { saveDrafts } from "@/lib/client/drafts-cache";
import { resizePhoto, type ResizedPhoto } from "@/lib/client/photo";
import type { CreateDraftsRequest } from "@/lib/contract";

export default function NewListingPage() {
  const merchant = useMerchant();
  const router = useRouter();
  const cameraId = useId();
  const libraryId = useId();
  const cameraRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<ResizedPhoto | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setPreparing(true);
    try {
      setPhoto(await resizePhoto(file));
    } catch {
      setPhoto(null);
      setError("Could not read this photo. Try another one.");
    } finally {
      setPreparing(false);
    }
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy || preparing) return;
    const body: CreateDraftsRequest = {};
    if (text.trim()) body.text = text.trim();
    if (photo) body.photo_base64 = photo.base64;
    if (!body.text && !body.photo_base64) {
      setError("Describe what you have, or add a photo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { drafts } = await createDrafts(merchant.id, body);
      if (drafts.length === 0) {
        router.push("/listing/manual?from=empty");
        return;
      }
      saveDrafts(drafts);
      router.push("/drafts");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const canSend = (text.trim() !== "" || photo !== null) && !busy && !preparing;

  const locked = busy || preparing;

  return (
    <form className="stack-lg" onSubmit={onSubmit} noValidate>
      <div className="stack">
        <h1>What&apos;s left of today&apos;s batch?</h1>
        <p className="muted">Take a photo or describe it in a sentence. We draft the listing, and you review it.</p>
      </div>

      <div className="stack">
        {photo ? (
          <div className="stack-sm">
            {/* eslint-disable-next-line @next/next/no-img-element -- local data: preview */}
            <img className="photo-preview" src={photo.previewUrl} alt="Selected photo" />
            <button type="button" className="link link-quiet" onClick={() => setPhoto(null)} disabled={busy}>
              Remove photo
            </button>
          </div>
        ) : (
          <div className="photo-pick">
            {/* capture opens the camera on phones; desktop browsers show the file picker */}
            <input
              ref={cameraRef}
              id={cameraId}
              type="file"
              accept="image/*"
              capture="environment"
              className="visually-hidden"
              onChange={onPhoto}
              disabled={locked}
            />
            <input
              id={libraryId}
              type="file"
              accept="image/*"
              className="visually-hidden"
              onChange={onPhoto}
              disabled={locked}
            />
            <label htmlFor={cameraId} className="btn btn-secondary btn-block" aria-disabled={locked}>
              {preparing ? "Preparing photo…" : "Take a photo"}
            </label>
            <label htmlFor={libraryId} className="link link-quiet" aria-disabled={locked}>
              Choose from your photos
            </label>
          </div>
        )}

        <label className="field">
          <span className="label">{photo ? "Add details (optional)" : "Or describe it in your own words"}</span>
          <textarea
            className="textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="6 croissants and 3 baguettes, until 6:00 PM"
            disabled={busy}
          />
          <span className="hint">We draft one listing per product. You check each one before it goes live.</span>
        </label>
      </div>

      <div className="stack">
        <InlineMessage error text={error} />
        {busy ? (
          <Spinner label="Drafting your listings. This can take up to 10 seconds." />
        ) : (
          <button type="submit" className="btn btn-primary btn-block" disabled={!canSend}>
            Draft listings
          </button>
        )}
        <p className="small center">
          <Link className="link link-quiet" href="/listing/manual">
            Enter the details myself
          </Link>
        </p>
        <p className="fine muted center">Nothing goes live until you approve it.</p>
      </div>
    </form>
  );
}
