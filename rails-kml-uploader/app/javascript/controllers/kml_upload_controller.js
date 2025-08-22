import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["dropzone", "fileInput", "uploadProgress", "submitButton"]

  connect() {
    this.setupDropzone()
  }

  setupDropzone() {
    const dropzone = this.dropzoneTarget
    const fileInput = this.fileInputTarget

    // Click to select file
    dropzone.addEventListener('click', () => {
      fileInput.click()
    })

    // Drag and drop handlers
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault()
      dropzone.classList.add('dragover')
    })

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover')
    })

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault()
      dropzone.classList.remove('dragover')
      
      const files = e.dataTransfer.files
      if (files.length > 0) {
        this.handleFile(files[0])
      }
    })

    // File input change handler
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleFile(e.target.files[0])
      }
    })
  }

  handleFile(file) {
    // Validate file type
    if (!file.name.toLowerCase().endsWith('.kml')) {
      alert('Please select a KML file (.kml extension)')
      return
    }

    // Update dropzone display
    this.dropzoneTarget.innerHTML = `
      <div class="text-success">
        <svg width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
          <path d="M8.5 11.5a.5.5 0 0 1-1 0V6.707L5.354 8.854a.5.5 0 1 1-.708-.708l3-3a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 6.707V11.5z"/>
          <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/>
        </svg>
        <div class="mt-2"><strong>${file.name}</strong></div>
        <div class="text-muted">${this.formatFileSize(file.size)}</div>
      </div>
    `
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes'
    
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  async submit(event) {
    event.preventDefault()
    
    const form = event.target
    const formData = new FormData(form)
    
    // Show progress
    this.uploadProgressTarget.classList.remove('d-none')
    this.submitButtonTarget.disabled = true
    this.submitButtonTarget.textContent = 'Uploading...'

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: formData,
        headers: {
          'X-CSRF-Token': document.querySelector('[name="csrf-token"]').content
        }
      })

      const result = await response.json()

      if (response.ok) {
        // Success - redirect to the KML file page
        window.location.href = result.redirect_url || '/kml_files'
      } else {
        // Error
        alert(result.errors ? result.errors.join(', ') : 'Upload failed')
        this.resetForm()
      }
    } catch (error) {
      console.error('Upload error:', error)
      alert('Upload failed. Please try again.')
      this.resetForm()
    }
  }

  resetForm() {
    this.uploadProgressTarget.classList.add('d-none')
    this.submitButtonTarget.disabled = false
    this.submitButtonTarget.textContent = 'Upload'
    
    // Reset dropzone
    this.dropzoneTarget.innerHTML = `
      <div class="mb-3">
        <svg class="text-muted mb-2" width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
          <path d="M8.5 11.5a.5.5 0 0 1-1 0V6.707L5.354 8.854a.5.5 0 1 1-.708-.708l3-3a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 6.707V11.5z"/>
          <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/>
        </svg>
        <div>Drag & drop your KML file here</div>
        <div class="text-muted">or click to browse</div>
      </div>
    `
  }
}