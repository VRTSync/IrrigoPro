import vrtSyncLogo from "@assets/FINAL-02_1754876518960.png";

export default function PoweredByFooter() {
  return (
    <div className="w-full bg-gray-50 border-t border-gray-200 py-4 px-6">
      <div className="flex items-center justify-center space-x-3">
        <span className="text-sm text-gray-600">Powered by</span>
        <img 
          src={vrtSyncLogo} 
          alt="VRTSync" 
          className="h-12 w-auto"
        />
      </div>
    </div>
  );
}