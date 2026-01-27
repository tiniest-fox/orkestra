/**
 * Splash screen shown during startup initialization.
 *
 * Displays a centered logo, app name, and loading animation
 * while the backend performs initialization tasks.
 */
export function StartupSplashScreen() {
  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        {/* Logo/Icon */}
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
          <svg
            className="w-10 h-10 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            {/* Music note / conductor baton icon */}
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
            />
          </svg>
        </div>

        {/* App name */}
        <h1 className="text-3xl font-semibold text-gray-800">Orkestra</h1>

        {/* Loading indicator - bouncing dots */}
        <div className="flex items-center gap-1.5">
          <div
            className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
            style={{ animationDelay: "-0.3s" }}
          />
          <div
            className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
            style={{ animationDelay: "-0.15s" }}
          />
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" />
        </div>

        <p className="text-sm text-gray-400">Initializing workspace...</p>
      </div>
    </div>
  );
}
