import vrtSyncLogo from "@assets/FINAL-02_1754876079512.png";

export default function PoweredByFooter() {
  return (
    <div className="w-full bg-gray-50 border-t border-gray-200 py-6 px-6">
      <div className="flex items-center justify-center space-x-3">
        <span className="text-base text-gray-600 font-medium">Powered by</span>
        <img 
          src={vrtSyncLogo} 
          alt="VRTSync" 
          className="h-10 w-auto"
        />
      </div>
    </div>
  );
}