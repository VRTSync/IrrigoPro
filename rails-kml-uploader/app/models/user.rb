class User < ApplicationRecord
  devise :database_authenticatable, :registerable,
         :recoverable, :rememberable, :validatable

  has_many :kml_files, dependent: :destroy
  has_many :controllers, through: :kml_files
  has_many :zones, through: :controllers

  validates :email, presence: true, uniqueness: true
  validates :first_name, :last_name, presence: true

  enum role: { user: 0, admin: 1, super_admin: 2 }

  def full_name
    "#{first_name} #{last_name}".strip
  end

  def can_upload_kml?
    admin? || super_admin?
  end

  def can_delete_data?
    admin? || super_admin?
  end
end