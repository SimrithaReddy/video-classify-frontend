import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io } from "socket.io-client";
import { API_BASE_URL, SOCKET_BASE_URL, api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { TenantUser, Video } from "../types";

type Filters = {
  sensitivityStatus: string;
  fromDate: string;
  toDate: string;
  minFileSize: string;
  maxFileSize: string;
  minDuration: string;
  maxDuration: string;
  q: string;
  category: string;
};

type UploadStage = "idle" | "uploading" | "processing" | "processed" | "failed";

const VIDEOS_PER_PAGE = 8;
const SUPPORTED_VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/ogg", "video/quicktime"];
const MAX_VIDEO_UPLOAD_SIZE_BYTES = 70 * 1024 * 1024;

const defaultFilters: Filters = {
  sensitivityStatus: "",
  fromDate: "",
  toDate: "",
  minFileSize: "",
  maxFileSize: "",
  minDuration: "",
  maxDuration: "",
  q: "",
  category: "",
};

export default function DashboardPage() {
  const { token, user, logout } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [categories, setCategories] = useState<string[]>([]);
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [selectedViewerIdsByVideo, setSelectedViewerIdsByVideo] = useState<Record<string, string[]>>({});
  const [accessScopeByVideo, setAccessScopeByVideo] = useState<Record<string, "restricted" | "tenant">>({});
  const [openAccessDropdownForVideoId, setOpenAccessDropdownForVideoId] = useState<string | null>(null);
  const [savingAssignmentsForVideoId, setSavingAssignmentsForVideoId] = useState<string | null>(null);
  const [selectedRoleByUserId, setSelectedRoleByUserId] = useState<Record<string, TenantUser["role"]>>({});
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [savingRoleForUserId, setSavingRoleForUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [qualityById, setQualityById] = useState<Record<string, "720" | "480" | "original">>({});
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [activeUploadVideoId, setActiveUploadVideoId] = useState<string | null>(null);
  const [activeUploadVideoTitle, setActiveUploadVideoTitle] = useState("");
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState<Video["processingStatus"] | "idle">("idle");
  const [liveSensitivityStatus, setLiveSensitivityStatus] =
    useState<Video["sensitivityStatus"]>("pending");
  const accessDropdownRef = useRef<HTMLDivElement | null>(null);

  const socketUrl = useMemo(() => SOCKET_BASE_URL, []);

  const loadVideos = useCallback(async () => {
    const params: Record<string, string> = {};
    if (filters.sensitivityStatus) params.sensitivityStatus = filters.sensitivityStatus;
    if (filters.fromDate) params.fromDate = filters.fromDate;
    if (filters.toDate) params.toDate = filters.toDate;
    if (filters.minFileSize) params.minFileSize = filters.minFileSize;
    if (filters.maxFileSize) params.maxFileSize = filters.maxFileSize;
    if (filters.minDuration) params.minDuration = filters.minDuration;
    if (filters.maxDuration) params.maxDuration = filters.maxDuration;
    if (filters.q.trim()) params.q = filters.q.trim();
    if (filters.category) params.category = filters.category;

    const { data } = await api.get<Video[]>("/videos", { params });
    setVideos(data);
  }, [filters]);

  const loadCategories = useCallback(async () => {
    const { data } = await api.get<string[]>("/videos/meta/categories");
    setCategories(data);
  }, []);

  const loadTenantUsers = useCallback(async () => {
    if (user?.role !== "admin") return;
    const { data } = await api.get<TenantUser[]>("/admin/users");
    setTenantUsers(data);
  }, [user?.role]);

  useEffect(() => {
    loadVideos().catch(() => setError("Unable to load videos"));
  }, [loadVideos]);

  useEffect(() => {
    loadCategories().catch(() => undefined);
  }, [loadCategories]);

  useEffect(() => {
    loadTenantUsers().catch(() => undefined);
  }, [loadTenantUsers]);

  useEffect(() => {
    setSelectedViewerIdsByVideo(
      videos.reduce<Record<string, string[]>>((acc, video) => {
        acc[video._id] = video.assignedViewerIds || [];
        return acc;
      }, {})
    );
    setAccessScopeByVideo(
      videos.reduce<Record<string, "restricted" | "tenant">>((acc, video) => {
        acc[video._id] = video.accessScope || "restricted";
        return acc;
      }, {})
    );
  }, [videos]);

  useEffect(() => {
    setSelectedRoleByUserId(
      tenantUsers.reduce<Record<string, TenantUser["role"]>>((acc, tenantUser) => {
        acc[tenantUser._id] = tenantUser.role;
        return acc;
      }, {})
    );
  }, [tenantUsers]);

  useEffect(() => {
    if (!token) return;
    const socket = io(socketUrl, {
      path: "/socket.io",
      transports: ["polling", "websocket"],
    });
    socket.emit("auth:join", token);

    socket.on("video:created", () => loadVideos().catch(() => undefined));
    socket.on(
      "video:progress",
      (payload: {
        videoId: string;
        progress: number;
        status?: Video["processingStatus"];
        sensitivityStatus?: Video["sensitivityStatus"];
      }) => {
        setVideos((prev) =>
          prev.map((item) =>
            item._id === payload.videoId
              ? {
                ...item,
                processingProgress: payload.progress,
                processingStatus: payload.status || item.processingStatus,
                sensitivityStatus: payload.sensitivityStatus || item.sensitivityStatus,
              }
              : item
          )
        );

        if (payload.videoId === activeUploadVideoId) {
          setUploadStage("processing");
          setProcessingProgress(payload.progress);
          setProcessingStatus(payload.status || "processing");
          if (payload.sensitivityStatus) {
            setLiveSensitivityStatus(payload.sensitivityStatus);
          }
        }
      }
    );
    socket.on(
      "video:completed",
      (payload: {
        videoId: string;
        progress: number;
        status: Video["processingStatus"];
        sensitivityStatus: Video["sensitivityStatus"];
      }) => {
        setVideos((prev) =>
          prev.map((item) =>
            item._id === payload.videoId
              ? {
                ...item,
                processingProgress: payload.progress,
                processingStatus: payload.status,
                sensitivityStatus: payload.sensitivityStatus,
              }
              : item
          )
        );

        if (payload.videoId === activeUploadVideoId) {
          setUploadStage(payload.status === "processed" ? "processed" : "failed");
          setProcessingProgress(payload.progress);
          setProcessingStatus(payload.status);
          setLiveSensitivityStatus(payload.sensitivityStatus);
        }

        loadVideos().catch(() => undefined);
      }
    );
    socket.on("video:deleted", () => loadVideos().catch(() => undefined));
    socket.on("video:failed", () => loadVideos().catch(() => undefined));
    return () => {
      socket.disconnect();
    };
  }, [token, socketUrl, loadVideos, activeUploadVideoId]);

  useEffect(() => {
    if (!openAccessDropdownForVideoId) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (accessDropdownRef.current?.contains(target)) return;
      setOpenAccessDropdownForVideoId(null);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [openAccessDropdownForVideoId]);

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const title = String(formData.get("title") || "").trim();
    const selectedFile = formData.get("video");

    if (!(selectedFile instanceof File) || selectedFile.size === 0) {
      setError("Please choose a video file before uploading.");
      setUploadStage("failed");
      window.alert("Please choose a video file before uploading.");
      return;
    }

    if (!SUPPORTED_VIDEO_MIME_TYPES.includes(selectedFile.type)) {
      const message = "Only video files are supported. Please choose a valid video file.";
      setError(message);
      setUploadStage("failed");
      window.alert(message);
      return;
    }

    if (selectedFile.size > MAX_VIDEO_UPLOAD_SIZE_BYTES) {
      const message = "Video size must be 70 MB or less.";
      setError(message);
      setUploadStage("failed");
      window.alert(message);
      return;
    }

    setUploading(true);
    setError("");
    setUploadPercent(0);
    setProcessingProgress(0);
    setProcessingStatus("idle");
    setLiveSensitivityStatus("pending");
    setUploadStage("uploading");
    setActiveUploadVideoId(null);
    setActiveUploadVideoTitle(title || "New video");
    try {
      const { data } = await api.post<Video>("/videos", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (progressEvent) => {
          if (!progressEvent.total) return;
          const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
          setUploadPercent(percent);
        },
      });
      setUploadPercent(100);
      setUploadStage("processing");
      setActiveUploadVideoId(data._id);
      setActiveUploadVideoTitle(data.title);
      setProcessingStatus(data.processingStatus);
      setLiveSensitivityStatus(data.sensitivityStatus);
      form.reset();
      await loadVideos();
      await loadCategories();
    } catch (requestError: any) {
      setUploadStage("failed");
      setError(
        requestError?.response?.data?.message ||
        requestError?.message ||
        "Upload failed"
      );
    } finally {
      setUploading(false);
    }
  }

  function streamUrlFor(video: Video) {
    if (video.playbackVariants) {
      const quality = qualityById[video._id] || "720";
      if (quality === "720" && video.playbackVariants.hd720) return video.playbackVariants.hd720;
      if (quality === "480" && video.playbackVariants.sd480) return video.playbackVariants.sd480;
      if (quality === "original" && video.playbackVariants.original) {
        return video.playbackVariants.original;
      }
    }

    return video.cloudinarySecureUrl || `${API_BASE_URL}/videos/${video._id}/stream`;
  }

  function previewUrlFor(video: Video) {
    if (video.processingStatus === "processed") {
      return streamUrlFor(video);
    }

    return video.cloudinarySecureUrl || `${API_BASE_URL}/videos/${video._id}/stream`;
  }

  function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function openUploadModal() {
    setError("");
    setUploadPercent(0);
    setProcessingProgress(0);
    setProcessingStatus("idle");
    setLiveSensitivityStatus("pending");
    setUploadStage("idle");
    setActiveUploadVideoId(null);
    setActiveUploadVideoTitle("");
    setShowUploadModal(true);
  }

  function closeUploadModal() {
    if (uploading) return;
    setShowUploadModal(false);
  }

  function uploadStageLabel() {
    if (uploadStage === "uploading") return "Uploading video to cloud storage";
    if (uploadStage === "processing") return "Real-time sensitivity analysis";
    if (uploadStage === "processed") return "Video is ready";
    if (uploadStage === "failed") return "Upload failed";
    return "Ready for a new video";
  }

  const assignableUsers = useMemo(
    () => tenantUsers.filter((tenantUser) => tenantUser.role !== "admin"),
    [tenantUsers]
  );
  const manageableUsers = useMemo(
    () => tenantUsers.filter((tenantUser) => tenantUser.role !== "admin"),
    [tenantUsers]
  );
  const totalPages = Math.max(1, Math.ceil(videos.length / VIDEOS_PER_PAGE));
  const paginatedVideos = useMemo(() => {
    const startIndex = (currentPage - 1) * VIDEOS_PER_PAGE;
    return videos.slice(startIndex, startIndex + VIDEOS_PER_PAGE);
  }, [currentPage, videos]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    filters.sensitivityStatus,
    filters.fromDate,
    filters.toDate,
    filters.minFileSize,
    filters.maxFileSize,
    filters.minDuration,
    filters.maxDuration,
    filters.q,
    filters.category,
  ]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  function toggleAccessDropdown(videoId: string) {
    setOpenAccessDropdownForVideoId((prev) => (prev === videoId ? null : videoId));
  }

  function toggleAllTenantAccess(videoId: string, checked: boolean) {
    setAccessScopeByVideo((prev) => ({
      ...prev,
      [videoId]: checked ? "tenant" : "restricted",
    }));
  }

  function toggleUserAccess(videoId: string, userId: string, checked: boolean) {
    setAccessScopeByVideo((prev) => ({
      ...prev,
      [videoId]: "restricted",
    }));
    setSelectedViewerIdsByVideo((prev) => {
      const current = prev[videoId] || [];
      if (checked) {
        return { ...prev, [videoId]: [...new Set([...current, userId])] };
      }
      return { ...prev, [videoId]: current.filter((id) => id !== userId) };
    });
  }

  async function saveViewerAssignments(videoId: string) {
    setError("");
    setSavingAssignmentsForVideoId(videoId);
    try {
      const viewerIds = selectedViewerIdsByVideo[videoId] || [];
      const accessScope = accessScopeByVideo[videoId] || "restricted";
      await api.patch(`/admin/videos/${videoId}/viewers`, { viewerIds, accessScope });
      await loadVideos();
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.message ||
        requestError?.message ||
        "Unable to save viewer assignments"
      );
    } finally {
      setSavingAssignmentsForVideoId(null);
    }
  }

  async function saveUserRole(userId: string) {
    setError("");
    const role = selectedRoleByUserId[userId];
    if (!role) return;
    setSavingRoleForUserId(userId);
    try {
      await api.patch(`/admin/users/${userId}/role`, { role });
      await loadTenantUsers();
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.message || requestError?.message || "Unable to update user role"
      );
    } finally {
      setSavingRoleForUserId(null);
    }
  }

  async function removeUser(userId: string) {
    setError("");
    setDeletingUserId(userId);
    try {
      await api.delete(`/admin/users/${userId}`);
      await Promise.all([loadTenantUsers(), loadVideos()]);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || requestError?.message || "Unable to delete user");
    } finally {
      setDeletingUserId(null);
    }
  }

  async function deleteVideoById(videoId: string) {
    const video = videos.find((item) => item._id === videoId);
    const confirmed = window.confirm(
      `Delete "${video?.title || "this video"}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    setError("");
    setDeletingVideoId(videoId);
    try {
      await api.delete(`/videos/${videoId}`);
      setOpenAccessDropdownForVideoId((current) => (current === videoId ? null : current));
      await Promise.all([loadVideos(), loadCategories()]);
    } catch (requestError: any) {
      setError(
        requestError?.response?.data?.message || requestError?.message || "Unable to delete video"
      );
    } finally {
      setDeletingVideoId(null);
    }
  }

  return (
    <div className="dashboard">
      <section className="hero-panel">
        <div className="hero-copy-block">
          <p className="eyebrow">Video Control Center</p>
          <h1>Upload, review, and play videos in one live dashboard</h1>
          <p className="hero-copy">
            Track upload progress in a popup, watch processing percentages update in real time,
            and see when a video becomes safe or flagged without refreshing the page.
          </p>
        </div>
        <div className="hero-actions">
          {(user?.role === "editor" || user?.role === "admin") && (
            <button className="primary-cta" onClick={openUploadModal}>
              Add Video
            </button>
          )}
          <button className="secondary" onClick={logout}>
            Logout
          </button>
        </div>
      </section>

      <section className="stats-grid">
        <article className="card stat-card">
          <span className="stat-label">User</span>
          <strong className="stat-user-name" title={user?.name || ""}>
            {user?.name}
          </strong>
          <span className="meta">
            {user?.role} on tenant {user?.tenantId}
          </span>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Total videos</span>
          <strong>{videos.length}</strong>
          <span className="meta">All uploads in your library</span>
        </article>
        <article className="card stat-card">
          <span className="stat-label">Flagged</span>
          <strong>{videos.filter((video) => video.sensitivityStatus === "flagged").length}</strong>
          <span className="meta">Needs manual review</span>
        </article>
      </section>

      <section className="card filters-card">
        <div className="library-head">
          <div>
            <h3>Library filters</h3>
            <p className="meta">Refine the library by safety, category, duration, date, and size.</p>
          </div>
          {(user?.role === "editor" || user?.role === "admin") && (
            <button className="secondary" onClick={openUploadModal}>
              Upload Video
            </button>
          )}
        </div>
        <div className="filters-grid">
          <label>
            Safety
            <select
              value={filters.sensitivityStatus}
              onChange={(e) => setFilters((f) => ({ ...f, sensitivityStatus: e.target.value }))}
            >
              <option value="">All</option>
              <option value="safe">Safe</option>
              <option value="flagged">Flagged</option>
            </select>
          </label>
          <label>
            Category
            <select
              value={filters.category}
              onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            Search
            <input
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="Search title, category, or file name"
            />
          </label>
          <label>
            From date
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => setFilters((f) => ({ ...f, fromDate: e.target.value }))}
            />
          </label>
          <label>
            To date
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value }))}
            />
          </label>
          <label>
            Min size
            <input
              type="number"
              min={0}
              value={filters.minFileSize}
              onChange={(e) => setFilters((f) => ({ ...f, minFileSize: e.target.value }))}
              placeholder="Bytes"
            />
          </label>
          <label>
            Max size
            <input
              type="number"
              min={0}
              value={filters.maxFileSize}
              onChange={(e) => setFilters((f) => ({ ...f, maxFileSize: e.target.value }))}
              placeholder="Bytes"
            />
          </label>
          <label>
            Min duration
            <input
              type="number"
              min={0}
              value={filters.minDuration}
              onChange={(e) => setFilters((f) => ({ ...f, minDuration: e.target.value }))}
              placeholder="Seconds"
            />
          </label>
          <label>
            Max duration
            <input
              type="number"
              min={0}
              value={filters.maxDuration}
              onChange={(e) => setFilters((f) => ({ ...f, maxDuration: e.target.value }))}
              placeholder="Seconds"
            />
          </label>
        </div>
        <div className="filter-actions">
          <button type="button" className="secondary" onClick={() => setFilters(defaultFilters)}>
            Clear filters
          </button>
        </div>
      </section>

      <section className="card">
        <div className="library-head">
          <div>
            <h3>Video Library</h3>
            <p className="meta">Responsive playback cards with live status indicators.</p>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="video-grid">
          {paginatedVideos.map((video) => {
            const previewUrl = previewUrlFor(video);
            const canDeleteVideo =
              user?.role === "admin" || (user?.role === "editor" && video.ownerId === user.id);

            return (
              <article className="video-card" key={video._id}>
              <div className="video-card-head">
                <h4 title={video.title}>{video.title}</h4>
                <span className={`pill ${video.sensitivityStatus}`}>{video.sensitivityStatus}</span>
              </div>
              <div className="video-info-row">
                <div className="video-info-left">
                  <p className="meta">
                    {video.category} · {formatBytes(video.fileSize)}
                    {video.durationSeconds != null && video.durationSeconds > 0
                      ? ` · ${video.durationSeconds}s`
                      : ""}
                  </p>
                  <div className="status-row compact">
                    <span className={`status-dot ${video.processingStatus}`} />
                    <span>{video.processingStatus}</span>
                  </div>
                </div>
                {canDeleteVideo && (
                  <button
                    type="button"
                    className="video-delete-btn"
                    onClick={() => deleteVideoById(video._id)}
                    disabled={deletingVideoId === video._id}
                    aria-label={`Delete ${video.title}`}
                    title="Delete video"
                  >
                    {deletingVideoId === video._id ? (
                      <span className="video-delete-btn-label">...</span>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="video-delete-icon">
                        <path
                          d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v7h-2v-7Zm4 0h2v7h-2v-7ZM7 10h2v7H7v-7Zm1 10c-1.1 0-2-.9-2-2V8h12v10c0 1.1-.9 2-2 2H8Z"
                          fill="currentColor"
                        />
                      </svg>
                    )}
                  </button>
                )}
              </div>
              <div className="progress-label">
                <span>Processing</span>
                <span>{video.processingProgress}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${video.processingProgress}%` }} />
              </div>
              {video.processingStatus === "processed" && (
                <>
                  <label className="quality-row">
                    Quality
                    <select
                      value={qualityById[video._id] || "720"}
                      onChange={(e) =>
                        setQualityById((prev) => ({
                          ...prev,
                          [video._id]: e.target.value as "720" | "480" | "original",
                        }))
                      }
                    >
                      <option value="720">720p</option>
                      <option value="480">480p</option>
                      <option value="original">Original</option>
                    </select>
                  </label>
                </>
              )}
              {previewUrl && (
                <>
                  <video
                    className="video-player"
                    controls
                    preload="metadata"
                    width="100%"
                    key={`${video._id}-${qualityById[video._id] || "720"}-${video.processingStatus}`}
                  >
                    <source src={previewUrl} type={video.mimeType} />
                  </video>
                </>
              )}
              {user?.role === "admin" && (
                <div className="assignment-panel">
                  <div
                    className="access-dropdown"
                    ref={openAccessDropdownForVideoId === video._id ? accessDropdownRef : null}
                  >
                    <button
                      type="button"
                      className="secondary access-dropdown-trigger"
                      onClick={() => toggleAccessDropdown(video._id)}
                    >
                      {(accessScopeByVideo[video._id] || "restricted") === "tenant"
                        ? "Access: All tenant users"
                        : `Access: ${(selectedViewerIdsByVideo[video._id] || []).length
                        } selected user(s)`}
                    </button>
                    {openAccessDropdownForVideoId === video._id && (
                      <div className="access-dropdown-menu">
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={(accessScopeByVideo[video._id] || "restricted") === "tenant"}
                            onChange={(event) =>
                              toggleAllTenantAccess(video._id, event.currentTarget.checked)
                            }
                          />
                          <span className="access-user-name" title="All tenant users">
                            All tenant users
                          </span>
                        </label>
                        {assignableUsers.map((tenantUser) => (
                          <label className="checkbox-row" key={tenantUser._id}>
                            <input
                              type="checkbox"
                              checked={(selectedViewerIdsByVideo[video._id] || []).includes(tenantUser._id)}
                              disabled={(accessScopeByVideo[video._id] || "restricted") === "tenant"}
                              onChange={(event) =>
                                toggleUserAccess(video._id, tenantUser._id, event.currentTarget.checked)
                              }
                            />
                            <span className="access-user-name" title={tenantUser.name}>
                              {tenantUser.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="secondary access-save-btn"
                    onClick={() => saveViewerAssignments(video._id)}
                    disabled={savingAssignmentsForVideoId === video._id}
                  >
                    {savingAssignmentsForVideoId === video._id ? "Saving..." : "Save access settings"}
                  </button>
                </div>
              )}
              </article>
            );
          })}
        </div>
        {videos.length > 0 && (
          <div className="pagination-row">
            <p className="pagination-meta">
              Page {currentPage} of {totalPages}
            </p>
            <div className="pagination-actions">
              <button
                type="button"
                className="secondary pagination-btn"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <button
                type="button"
                className="secondary pagination-btn"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      {user?.role === "admin" && (
        <section className="card">
          <div className="library-head">
            <div>
              <h3>Tenant user management</h3>
              <p className="meta">Review all users, edit roles, and remove access when needed.</p>
            </div>
          </div>
          <div className="admin-user-grid">
            {manageableUsers.map((tenantUser) => (
              <article className="admin-user-card" key={tenantUser._id}>
                <strong className="admin-user-name" title={tenantUser.name}>
                  {tenantUser.name}
                </strong>
                <div className="admin-user-actions">
                  <select
                    value={selectedRoleByUserId[tenantUser._id] || tenantUser.role}
                    onChange={(event) => {
                      const role = event.currentTarget.value as TenantUser["role"];
                      setSelectedRoleByUserId((prev) => ({
                        ...prev,
                        [tenantUser._id]: role,
                      }));
                    }}
                    disabled={tenantUser?._id === user?.id || savingRoleForUserId === tenantUser._id}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <button
                    type="button"
                    className="secondary"
                    disabled={savingRoleForUserId === tenantUser._id || tenantUser._id === user.id}
                    onClick={() => saveUserRole(tenantUser._id)}
                  >
                    {savingRoleForUserId === tenantUser._id ? "Saving..." : "Save role"}
                  </button>
                  <button
                    type="button"
                    disabled={deletingUserId === tenantUser._id || tenantUser._id === user.id}
                    onClick={() => removeUser(tenantUser._id)}
                  >
                    {deletingUserId === tenantUser._id ? "Removing..." : "Remove user"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {showUploadModal && (
        <div className="modal-backdrop" onClick={closeUploadModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
              <h2>Add a video</h2>
              </div>
              <button className="secondary icon-btn" onClick={closeUploadModal} disabled={uploading}>
                Close
              </button>
            </div>

            <form onSubmit={onUpload} className="upload-modal-form">
              <input required name="title" placeholder="Video title" />
              <input name="category" placeholder="Category" defaultValue="general" />
              <input
                required
                type="file"
                name="video"
                accept="video/mp4,video/webm,video/ogg,video/quicktime"
              />
              <button type="submit" disabled={uploading}>
                {uploading ? "Uploading..." : "Upload Video"}
              </button>
            </form>

            <section className="live-panel">
              <div className="live-panel-head">
                <div>
                  <span className="meta">Current upload: </span>
                  <strong>{activeUploadVideoTitle || "No file selected yet"}</strong>
                </div>
                <span className={`pill ${liveSensitivityStatus}`}>{liveSensitivityStatus}</span>
              </div>

              <div className="progress-group">
                <div className="progress-label">
                  <span>Upload progress</span>
                  <span>{uploadPercent}%</span>
                </div>
                <div className="progress-track large">
                  <div className="progress-fill accent" style={{ width: `${uploadPercent}%` }} />
                </div>
              </div>

              <div className="progress-group">
                <div className="progress-label">
                  <span>{uploadStageLabel()}</span>
                  <span>{processingProgress}%</span>
                </div>
                <div className="progress-track large">
                  <div className="progress-fill" style={{ width: `${processingProgress}%` }} />
                </div>
              </div>

              <div className="live-status-grid">
                <article className="status-panel">
                  <span className="meta">Processing: </span>
                  <strong>{processingStatus}</strong>
                </article>
                <article className="status-panel">
                  <span className="meta">Sensitivity: </span>
                  <strong>{liveSensitivityStatus}</strong>
                </article>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
