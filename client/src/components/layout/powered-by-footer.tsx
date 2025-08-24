import irrigoProLogo from "@assets/irrigopro - logo - BLUE - FINAL_1756061385150.png";

export default function PoweredByFooter() {
  return (
    <div className="w-full bg-white/50 backdrop-blur-sm border-t border-gray-200/50 py-4 px-6">
      <div className="flex items-center justify-center space-x-3">
        <span className="text-sm text-gray-700">Powered by</span>
        <img 
          src={irrigoProLogo} 
          alt="IrrigoPro" 
          className="h-8 w-auto"
        />
      </div>
    </div>
  );
}