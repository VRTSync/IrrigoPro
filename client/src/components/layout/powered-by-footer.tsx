import vrtSyncLogo from "@assets/VRTSync-LOGO-1_1754876481741.png";

export default function PoweredByFooter() {
  return (
    <div className="w-full bg-gray-50 border-t border-gray-200 py-4 px-6">
      <div className="flex items-center justify-center space-x-3">
        <span className="text-sm text-gray-600">Powered by</span>
        <img 
          src={vrtSyncLogo} 
          alt="VRTSync" 
          className="h-20 w-auto"
        />
      </div>
    </div>
  );
}