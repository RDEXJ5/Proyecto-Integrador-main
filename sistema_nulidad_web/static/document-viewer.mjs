const viewer = document.querySelector("[data-document-viewer]");

if (viewer) {
  initializeViewer(viewer).catch(() => {
    const message = viewer.querySelector("#viewer-message");
    if (message) {
      message.textContent = "No fue posible iniciar el visor protegido.";
      message.classList.add("is-error");
    }
  });
}

async function initializeViewer(root) {
  const pdfjs = await import(root.dataset.pdfjsModule);
  pdfjs.GlobalWorkerOptions.workerSrc = root.dataset.pdfjsWorker;

  const stage = root.querySelector("#viewer-stage");
  const canvas = root.querySelector("#viewer-canvas");
  const image = root.querySelector("#viewer-image");
  const message = root.querySelector("#viewer-message");
  const title = root.querySelector("#viewer-title");
  const fileName = root.querySelector("#viewer-file-name");
  const previous = root.querySelector("#viewer-previous");
  const next = root.querySelector("#viewer-next");
  const zoomOut = root.querySelector("#viewer-zoom-out");
  const zoomIn = root.querySelector("#viewer-zoom-in");
  const pageStatus = root.querySelector("#viewer-page-status");
  const zoomStatus = root.querySelector("#viewer-zoom-status");
  const download = root.querySelector("#viewer-download");
  const previewButtons = [...document.querySelectorAll(".js-preview-document")];

  let pdfDocument = null;
  let loadingTask = null;
  let renderTask = null;
  let currentPage = 1;
  let zoom = 1;
  let requestSequence = 0;

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("is-error", isError);
    message.hidden = false;
    canvas.hidden = true;
    image.hidden = true;
  }

  function setPdfControls(enabled) {
    previous.disabled = !enabled || currentPage <= 1;
    next.disabled = !enabled || !pdfDocument || currentPage >= pdfDocument.numPages;
    zoomOut.disabled = !enabled || zoom <= 0.5;
    zoomIn.disabled = !enabled || zoom >= 2.5;
  }

  function updateStatus() {
    pageStatus.textContent = pdfDocument
      ? `Página ${currentPage} de ${pdfDocument.numPages}`
      : "Página - de -";
    zoomStatus.textContent = `${Math.round(zoom * 100)}%`;
    setPdfControls(Boolean(pdfDocument));
  }

  async function clearCurrentDocument() {
    requestSequence += 1;
    if (renderTask) {
      renderTask.cancel();
      renderTask = null;
    }
    if (loadingTask) {
      await loadingTask.destroy().catch(() => undefined);
      loadingTask = null;
    }
    pdfDocument = null;
    image.removeAttribute("src");
    currentPage = 1;
    zoom = 1;
    updateStatus();
  }

  async function renderPage() {
    if (!pdfDocument) return;
    const sequence = requestSequence;
    setMessage(`Renderizando la página ${currentPage}...`);
    const page = await pdfDocument.getPage(currentPage);
    if (sequence !== requestSequence) return;

    const viewport = page.getViewport({ scale: zoom });
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    const context = canvas.getContext("2d", { alpha: false });
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    renderTask = page.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
    });
    try {
      await renderTask.promise;
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") throw error;
      return;
    } finally {
      renderTask = null;
    }
    if (sequence !== requestSequence) return;
    message.hidden = true;
    image.hidden = true;
    canvas.hidden = false;
    updateStatus();
  }

  async function loadPdf(url) {
    setMessage("Descifrando y verificando el documento...");
    const sequence = requestSequence;
    loadingTask = pdfjs.getDocument({
      url,
      withCredentials: true,
      cMapUrl: root.dataset.pdfjsCmaps,
      cMapPacked: true,
      standardFontDataUrl: root.dataset.pdfjsFonts,
      isEvalSupported: false,
      useWasm: false,
    });
    pdfDocument = await loadingTask.promise;
    if (sequence !== requestSequence) return;

    const firstPage = await pdfDocument.getPage(1);
    const unscaled = firstPage.getViewport({ scale: 1 });
    const availableWidth = Math.max(stage.clientWidth - 48, 320);
    zoom = Math.max(0.5, Math.min(1.5, availableWidth / unscaled.width));
    await renderPage();
  }

  function loadImage(url) {
    setMessage("Cargando imagen protegida...");
    image.onload = () => {
      message.hidden = true;
      canvas.hidden = true;
      image.hidden = false;
    };
    image.onerror = () => setMessage("No fue posible mostrar la imagen.", true);
    image.src = url;
  }

  async function selectVersion(button, shouldScroll) {
    await clearCurrentDocument();
    previewButtons.forEach((candidate) => candidate.classList.toggle("is-selected", candidate === button));
    title.textContent = `Vista previa - Versión ${button.dataset.versionNumber}`;
    fileName.textContent = button.dataset.fileName;
    if (download) {
      if (button.dataset.downloadUrl) {
        download.href = button.dataset.downloadUrl;
        download.hidden = false;
      } else {
        download.hidden = true;
        download.removeAttribute("href");
      }
    }

    if (shouldScroll) root.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      if (button.dataset.contentType === "application/pdf") {
        await loadPdf(button.dataset.previewUrl);
      } else if (button.dataset.contentType.startsWith("image/")) {
        setPdfControls(false);
        loadImage(button.dataset.previewUrl);
      } else {
        setPdfControls(false);
        setMessage("Este formato necesita convertirse a PDF antes de poder mostrarse sin descargar el original.");
      }
    } catch {
      setMessage("No fue posible abrir esta versión. Verifica que tu sesión siga vigente.", true);
    }
  }

  previous.addEventListener("click", async () => {
    if (pdfDocument && currentPage > 1) {
      currentPage -= 1;
      await renderPage();
    }
  });
  next.addEventListener("click", async () => {
    if (pdfDocument && currentPage < pdfDocument.numPages) {
      currentPage += 1;
      await renderPage();
    }
  });
  zoomOut.addEventListener("click", async () => {
    if (pdfDocument) {
      zoom = Math.max(0.5, zoom - 0.15);
      await renderPage();
    }
  });
  zoomIn.addEventListener("click", async () => {
    if (pdfDocument) {
      zoom = Math.min(2.5, zoom + 0.15);
      await renderPage();
    }
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  image.addEventListener("contextmenu", (event) => event.preventDefault());
  previewButtons.forEach((button) => {
    button.addEventListener("click", () => selectVersion(button, true));
  });

  updateStatus();
  if (previewButtons.length > 0) {
    await selectVersion(previewButtons[0], false);
  }
}
