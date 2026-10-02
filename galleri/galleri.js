import { supabase, isSupabaseConfigured } from "../shared/supabase-client.js";
import { getMyProfile } from "../shared/auth.js";

const BUCKET = "gallery";
// Billeder skaleres ned i browseren før upload, så de ikke æder pladsen i Supabase.
const FULL_MAX_SIZE = 1600;
const FULL_QUALITY = 0.82;
const THUMB_MAX_SIZE = 480;
const THUMB_QUALITY = 0.7;

const els = {
  albumsView: document.querySelector("#albumsView"),
  albumList: document.querySelector("#albumList"),
  albumsStatus: document.querySelector("#albumsStatus"),
  albumFormCard: document.querySelector("#albumFormCard"),
  albumForm: document.querySelector("#albumForm"),
  albumTitle: document.querySelector("#albumTitle"),
  albumDate: document.querySelector("#albumDate"),
  albumSubmitBtn: document.querySelector("#albumSubmitBtn"),
  albumFormStatus: document.querySelector("#albumFormStatus"),

  albumView: document.querySelector("#albumView"),
  albumHeading: document.querySelector("#albumHeading"),
  albumMeta: document.querySelector("#albumMeta"),
  adminBar: document.querySelector("#adminBar"),
  photoInput: document.querySelector("#photoInput"),
  deleteAlbumBtn: document.querySelector("#deleteAlbumBtn"),
  photosStatus: document.querySelector("#photosStatus"),
  photoGrid: document.querySelector("#photoGrid"),
  backLink: document.querySelector("#backLink"),
  eventsLink: document.querySelector("#eventsLink"),

  lightbox: document.querySelector("#lightbox"),
  lightboxImage: document.querySelector("#lightboxImage"),
  lightboxCount: document.querySelector("#lightboxCount"),
  lightboxClose: document.querySelector("#lightboxClose"),
  lightboxPrev: document.querySelector("#lightboxPrev"),
  lightboxNext: document.querySelector("#lightboxNext"),
  lightboxDelete: document.querySelector("#lightboxDelete"),
};

let isAdmin = false;
let currentAlbum = null;
let photos = [];
let lightboxIndex = -1;

function setStatus(element, message = "", type = "") {
  element.textContent = message;
  element.className = `member-status ${type}`.trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function publicUrl(path) {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function formatAlbumDate(value) {
  if (!value) return "";
  return new Date(`${value}T12:00:00`).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" });
}

function photoCountLabel(count) {
  return count === 1 ? "1 billede" : `${count} billeder`;
}

function currentAlbumId() {
  const match = window.location.hash.match(/^#\/album\/([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

/* ---------- Albums ---------- */

async function showAlbums() {
  currentAlbum = null;
  photos = [];
  els.albumView.classList.add("hidden");
  els.backLink.classList.add("hidden");
  els.albumsView.classList.remove("hidden");
  els.albumFormCard.classList.toggle("hidden", !isAdmin);
  setStatus(els.albumsStatus, els.albumList.children.length ? "" : "Henter albums...");

  const { data, error } = await supabase
    .from("gallery_albums")
    .select("id, title, event_date, created_at, gallery_photos(count)")
    .order("event_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(els.albumsStatus, error.message, "error");
    return;
  }

  const albums = data || [];

  // Forsidebillede = første billede i hvert album.
  const covers = await Promise.all(
    albums.map((album) =>
      supabase
        .from("gallery_photos")
        .select("thumb_path")
        .eq("album_id", album.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
    )
  );

  setStatus(els.albumsStatus, "");

  if (!albums.length) {
    els.albumList.innerHTML = `
      <div class="event-empty">
        <strong>Ingen billeder endnu</strong>
        Galleriet er på vej – kig forbi igen snart.
      </div>
    `;
    return;
  }

  els.albumList.innerHTML = albums
    .map((album, index) => {
      const cover = covers[index].data?.thumb_path;
      const count = album.gallery_photos?.[0]?.count || 0;
      const date = formatAlbumDate(album.event_date);
      return `
        <a class="album-card" href="#/album/${escapeHtml(album.id)}">
          ${cover
            ? `<img src="${escapeHtml(publicUrl(cover))}" alt="" loading="lazy" />`
            : `<span class="album-card__placeholder">▣</span>`}
          <span class="album-card__text">
            <strong>${escapeHtml(album.title)}</strong>
            <small>${escapeHtml([date, photoCountLabel(count)].filter(Boolean).join(" · "))}</small>
          </span>
        </a>
      `;
    })
    .join("");
}

async function createAlbum() {
  const title = els.albumTitle.value.trim();
  if (!title) return;

  setStatus(els.albumFormStatus, "Opretter...");
  els.albumSubmitBtn.disabled = true;

  const { data, error } = await supabase
    .from("gallery_albums")
    .insert({ title, event_date: els.albumDate.value || null })
    .select("id")
    .single();

  els.albumSubmitBtn.disabled = false;

  if (error) {
    setStatus(els.albumFormStatus, error.message, "error");
    return;
  }

  els.albumForm.reset();
  setStatus(els.albumFormStatus, "");
  window.location.hash = `#/album/${data.id}`;
}

/* ---------- Ét album ---------- */

function renderPhotos() {
  const date = formatAlbumDate(currentAlbum.event_date);
  els.albumMeta.textContent = [date, photoCountLabel(photos.length)].filter(Boolean).join(" · ");

  if (!photos.length) {
    els.photoGrid.innerHTML = `
      <div class="event-empty">
        <strong>Tomt album</strong>
        Der er ikke lagt billeder i albummet endnu.
      </div>
    `;
    return;
  }

  els.photoGrid.innerHTML = photos
    .map((photo, index) => `
      <button class="photo-thumb" type="button" data-index="${index}" aria-label="Åbn billede ${index + 1}">
        <img src="${escapeHtml(publicUrl(photo.thumb_path))}" alt="" loading="lazy" />
      </button>
    `)
    .join("");

  els.photoGrid.querySelectorAll(".photo-thumb").forEach((button) => {
    button.addEventListener("click", () => openLightbox(Number(button.dataset.index)));
  });
}

async function loadPhotos() {
  const { data, error } = await supabase
    .from("gallery_photos")
    .select("id, path, thumb_path, width, height")
    .eq("album_id", currentAlbum.id)
    .order("created_at", { ascending: true });

  if (error) {
    setStatus(els.photosStatus, error.message, "error");
    return;
  }

  photos = data || [];
  renderPhotos();
}

async function showAlbum(albumId) {
  els.albumsView.classList.add("hidden");
  els.albumView.classList.remove("hidden");
  els.backLink.classList.remove("hidden");
  els.adminBar.classList.toggle("hidden", !isAdmin);
  els.albumHeading.textContent = "Album";
  els.albumMeta.textContent = "";
  els.photoGrid.innerHTML = "";
  setStatus(els.photosStatus, "Henter billeder...");

  const { data, error } = await supabase
    .from("gallery_albums")
    .select("id, title, event_date")
    .eq("id", albumId)
    .maybeSingle();

  if (error || !data) {
    setStatus(els.photosStatus, error?.message || "Albummet findes ikke længere.", "error");
    els.adminBar.classList.add("hidden");
    return;
  }

  currentAlbum = data;
  els.albumHeading.textContent = data.title;
  setStatus(els.photosStatus, "");
  await loadPhotos();
}

/* ---------- Upload med nedskalering ---------- */

function resizeToJpeg(bitmap, maxSize, quality) {
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, width, height }) : reject(new Error("Billedet kunne ikke gemmes."))),
      "image/jpeg",
      quality
    );
  });
}

async function uploadPhoto(file) {
  let bitmap;
  try {
    // from-image retter billeder, der er taget med telefonen på højkant.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (_error) {
    throw new Error("filen kan ikke læses som et billede");
  }

  const full = await resizeToJpeg(bitmap, FULL_MAX_SIZE, FULL_QUALITY);
  const thumb = await resizeToJpeg(bitmap, THUMB_MAX_SIZE, THUMB_QUALITY);
  bitmap.close();

  const name = `${currentAlbum.id}/${crypto.randomUUID()}`;
  const path = `${name}.jpg`;
  const thumbPath = `${name}_thumb.jpg`;
  const options = { contentType: "image/jpeg", cacheControl: "31536000" };
  const bucket = supabase.storage.from(BUCKET);

  const fullUpload = await bucket.upload(path, full.blob, options);
  if (fullUpload.error) throw new Error(fullUpload.error.message);

  const thumbUpload = await bucket.upload(thumbPath, thumb.blob, options);
  if (thumbUpload.error) {
    await bucket.remove([path]);
    throw new Error(thumbUpload.error.message);
  }

  const { error } = await supabase.from("gallery_photos").insert({
    album_id: currentAlbum.id,
    path,
    thumb_path: thumbPath,
    width: full.width,
    height: full.height,
  });

  if (error) {
    await bucket.remove([path, thumbPath]);
    throw new Error(error.message);
  }
}

async function uploadPhotos(files) {
  if (!currentAlbum || !files.length) return;

  const failed = [];
  for (const [index, file] of files.entries()) {
    setStatus(els.photosStatus, `Uploader ${index + 1} af ${files.length}...`);
    try {
      await uploadPhoto(file);
    } catch (error) {
      failed.push(`${file.name}: ${error.message}`);
    }
  }

  await loadPhotos();

  const uploaded = files.length - failed.length;
  if (failed.length) {
    setStatus(els.photosStatus, `${uploaded} af ${files.length} uploadet. Fejl: ${failed.join("; ")}`, "error");
  } else {
    setStatus(els.photosStatus, `${photoCountLabel(uploaded)} uploadet.`, "success");
  }
}

/* ---------- Sletning ---------- */

async function deletePhoto(photo) {
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([photo.path, photo.thumb_path]);
  if (storageError) throw new Error(storageError.message);

  const { error } = await supabase.from("gallery_photos").delete().eq("id", photo.id);
  if (error) throw new Error(error.message);
}

async function deleteCurrentPhoto() {
  const photo = photos[lightboxIndex];
  if (!photo || !window.confirm("Slet dette billede?\n\nDet kan ikke fortrydes.")) return;

  try {
    await deletePhoto(photo);
  } catch (error) {
    closeLightbox();
    setStatus(els.photosStatus, error.message, "error");
    return;
  }

  photos.splice(lightboxIndex, 1);
  renderPhotos();

  if (!photos.length) closeLightbox();
  else openLightbox(Math.min(lightboxIndex, photos.length - 1));
}

async function deleteAlbum() {
  if (!currentAlbum) return;

  const confirmed = window.confirm(
    `Slet albummet '${currentAlbum.title}' og alle ${photos.length} billeder i det?\n\nDet kan ikke fortrydes.`
  );
  if (!confirmed) return;

  setStatus(els.photosStatus, "Sletter album...");

  const paths = photos.flatMap((photo) => [photo.path, photo.thumb_path]);
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove(paths);
    if (storageError) {
      setStatus(els.photosStatus, storageError.message, "error");
      return;
    }
  }

  const { error } = await supabase.from("gallery_albums").delete().eq("id", currentAlbum.id);
  if (error) {
    setStatus(els.photosStatus, error.message, "error");
    return;
  }

  window.location.hash = "";
}

/* ---------- Stor visning ---------- */

function openLightbox(index) {
  lightboxIndex = index;
  els.lightboxImage.src = publicUrl(photos[index].path);
  els.lightboxCount.textContent = `${index + 1} / ${photos.length}`;
  els.lightboxDelete.classList.toggle("hidden", !isAdmin);
  els.lightbox.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightboxIndex = -1;
  els.lightbox.classList.add("hidden");
  els.lightboxImage.removeAttribute("src");
  document.body.style.overflow = "";
}

function stepLightbox(direction) {
  if (lightboxIndex < 0 || !photos.length) return;
  openLightbox((lightboxIndex + direction + photos.length) % photos.length);
}

/* ---------- Opstart og knapper ---------- */

async function route() {
  closeLightbox();
  const albumId = currentAlbumId();
  if (albumId) await showAlbum(albumId);
  else await showAlbums();
}

async function init() {
  if (!isSupabaseConfigured()) return;

  // Admin logger ind på /member – sessionen deles med galleriet.
  const profile = await getMyProfile();
  isAdmin = profile?.role === "admin";
  // Events-siden er intern, så linket vises kun for medlemmer, der er logget ind.
  els.eventsLink.classList.toggle("hidden", !profile);

  await route();
}

window.addEventListener("hashchange", route);

els.albumForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await createAlbum();
});

els.photoInput.addEventListener("change", async () => {
  const files = [...els.photoInput.files];
  els.photoInput.value = "";
  await uploadPhotos(files);
});

els.deleteAlbumBtn.addEventListener("click", deleteAlbum);

els.lightboxClose.addEventListener("click", closeLightbox);
els.lightboxPrev.addEventListener("click", () => stepLightbox(-1));
els.lightboxNext.addEventListener("click", () => stepLightbox(1));
els.lightboxDelete.addEventListener("click", deleteCurrentPhoto);

els.lightbox.addEventListener("click", (event) => {
  if (event.target === els.lightbox) closeLightbox();
});

document.addEventListener("keydown", (event) => {
  if (lightboxIndex < 0) return;
  if (event.key === "Escape") closeLightbox();
  if (event.key === "ArrowLeft") stepLightbox(-1);
  if (event.key === "ArrowRight") stepLightbox(1);
});

// Swipe til siden for at bladre på telefon.
let touchStartX = null;
els.lightbox.addEventListener("touchstart", (event) => {
  touchStartX = event.touches[0].clientX;
}, { passive: true });

els.lightbox.addEventListener("touchend", (event) => {
  if (touchStartX === null) return;
  const delta = event.changedTouches[0].clientX - touchStartX;
  touchStartX = null;
  if (Math.abs(delta) > 50) stepLightbox(delta > 0 ? -1 : 1);
}, { passive: true });

init();
