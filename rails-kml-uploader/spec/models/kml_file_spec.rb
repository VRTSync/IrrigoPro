require 'rails_helper'

RSpec.describe KmlFile, type: :model do
  let(:user) { create(:user) }
  
  describe 'associations' do
    it { should belong_to(:user) }
    it { should have_many(:controllers).dependent(:destroy) }
    it { should have_many(:zones).through(:controllers) }
  end

  describe 'validations' do
    it { should validate_presence_of(:name) }
    it { should validate_presence_of(:file) }
  end

  describe 'enums' do
    it { should define_enum_for(:status).with_values(pending: 0, processing: 1, completed: 2, failed: 3) }
  end

  describe '#file_size_humanized' do
    let(:kml_file) { create(:kml_file, user: user) }
    
    context 'when file is attached' do
      before do
        kml_file.file.attach(
          io: StringIO.new('test content'),
          filename: 'test.kml',
          content_type: 'application/vnd.google-earth.kml+xml'
        )
      end
      
      it 'returns human-readable file size' do
        expect(kml_file.file_size_humanized).to match(/\d+(\.\d+)?\s+(B|KB|MB|GB)/)
      end
    end
    
    context 'when no file is attached' do
      it 'returns "0 KB"' do
        expect(kml_file.file_size_humanized).to eq('0 KB')
      end
    end
  end

  describe '#center_coordinates' do
    let(:kml_file) { create(:kml_file, user: user) }
    
    context 'when controllers exist' do
      before do
        create(:controller, kml_file: kml_file, location: 'POINT(-122.4194 37.7749)')
        create(:controller, kml_file: kml_file, location: 'POINT(-122.4094 37.7849)')
      end
      
      it 'returns the center of all controllers' do
        center = kml_file.center_coordinates
        expect(center).to be_an(Array)
        expect(center.length).to eq(2)
        expect(center[0]).to be_within(0.01).of(37.7799)
        expect(center[1]).to be_within(0.01).of(-122.4144)
      end
    end
    
    context 'when no controllers exist' do
      it 'returns San Francisco coordinates as default' do
        expect(kml_file.center_coordinates).to eq([37.7749, -122.4194])
      end
    end
  end

  describe '#processing_complete?' do
    let(:kml_file) { create(:kml_file, user: user) }
    
    it 'returns true when status is completed' do
      kml_file.update(status: :completed)
      expect(kml_file.processing_complete?).to be true
    end
    
    it 'returns true when status is failed' do
      kml_file.update(status: :failed)
      expect(kml_file.processing_complete?).to be true
    end
    
    it 'returns false when status is pending' do
      kml_file.update(status: :pending)
      expect(kml_file.processing_complete?).to be false
    end
    
    it 'returns false when status is processing' do
      kml_file.update(status: :processing)
      expect(kml_file.processing_complete?).to be false
    end
  end

  describe 'callbacks' do
    it 'enqueues processing job after creation' do
      expect {
        create(:kml_file, user: user)
      }.to change(KmlProcessingJob.jobs, :size).by(1)
    end
  end
end